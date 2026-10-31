import {deriveOriginal314RecordedPredecessor} from './fixtures/derive-recorded-predecessor.mjs';
import {validateFullNineV6FixtureBytes} from '../scripts/fixtures/full-nine-v6-source.mjs';
// MAIN-ONLY SOURCE: not executed by Worker1. Fresh owned SQL integration only.
// No production URL/container adoption, release/app build, provider or audit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,isAbsolute,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import pg from '../node_modules/pg/lib/index.js';
import {createCiFreshOnlyFixture} from '../scripts/ci-fresh-only-replay.mjs';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from '../scripts/fixtures/event-static-authority-fixture.mjs';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualCoverAllActivation} from '../src/approved-manual-coverall-workflow.js';
import {prepareApprovedManualEmploymentAdmission,readOwnerConfirmedEmploymentAdmissionData} from '../src/approved-manual-employment-admission.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {projectManagerSession} from '../src/auth/manager-permissions.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from '../scripts/schema-fingerprint-catalog.mjs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
const W=dirname(fileURLToPath(import.meta.url)),B=resolve(W,'..'),OWNER='00000000-0000-4000-8000-000000000001';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COMPONENTS=[
 'proposals/approved-manual-employment-admission.sql','proposals/approved-manual-employment-native-read.sql',
 'proposals/approved-manual-native-period.sql','proposals/approved-manual-coverall-workflow.sql',
 'proposals/approved-manual-coverall-management.sql',
 'proposals/approved-manual-initial-employment-native-guard.sql','proposals/approved-manual-recurring-period.sql',
 'proposals/approved-manual-recurring-native.sql','proposals/approved-manual-notification-continuity.sql',
 'proposals/custodial-leadership-pin.sql','proposals/custodial-leadership-runtime-grants.sql',
 'proposals/approved-manual-release-packet-preparation.sql',
 'proposals/approved-manual-device-delivery.sql'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const exact=(x,ks)=>{assert.ok(x&&Object.getPrototypeOf(x)===Object.prototype);assert.deepEqual(Object.keys(x).sort(),ks.slice().sort());};
const identity=s=>[s.dev,s.ino,s.mode,s.nlink,s.uid,s.gid,s.size,s.mtimeNs.toString(),s.ctimeNs.toString()];
function readFixed(ref){
 exact(ref,['path','sha256','bytes']);assert.ok(isAbsolute(ref.path));assert.match(ref.sha256,HASH);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&ref.bytes<=64*1024*1024);
 const p=resolve(ref.path);assert.ok(p.startsWith(B+'/')||p.startsWith(W+'/'));
 for(let q=p;q!==dirname(q);q=dirname(q)){assert.equal(fs.lstatSync(q).isSymbolicLink(),false);if(q===B||q===W)break;}
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  const a=fs.fstatSync(fd,{bigint:true});assert.ok(a.isFile());assert.equal(a.nlink,1n);const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd,{bigint:true});
  assert.deepEqual(identity(a),identity(b));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return bytes;
 }finally{fs.closeSync(fd);}
}
function sourceSnapshot(paths){return paths.map(p=>{const s=fs.lstatSync(p,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink());assert.equal(s.nlink,1n);const bytes=fs.readFileSync(p);assert.deepEqual(identity(s),identity(fs.lstatSync(p,{bigint:true})));return{path:p,sha256:sha(bytes),bytes:bytes.length,identity9:identity(s).map(v=>typeof v==='bigint'?v.toString():v)};});}
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+86400000*n).toISOString().slice(0,10);
const stripTransaction=sql=>sql.replace(/^BEGIN;\s*$/gim,'').replace(/^COMMIT;\s*$/gim,'');

// A native PostgreSQL port for the UNCHANGED official helper's one temporary
// JSON input transport. Only its fixed event_rpc_input COPY grammar is adapted
// to native bound JSONB values. No compiler/envelope/receipt fields are changed.
function copiedPort(statement){
 const match=statement.match(/^begin;\s*create temporary table event_rpc_input\(([^\n]+)\) on commit drop;\s*copy pg_temp\.event_rpc_input\(([^)]+)\) from stdin;\n([^\n]*)\n\\\.\n([\s\S]*)$/);
 if(!match)return null;
 const columns=match[2].split(',');assert.ok(columns.length>=1&&columns.length<=8&&columns.every(v=>/^[a-z_]+$/.test(v)));
 assert.equal(match[1],columns.map(c=>c+' jsonb').join(','));
 const raw=match[3].split('\t');assert.equal(raw.length,columns.length);
 const values=raw.map(s=>s.replace(/\\([\\nrt])/g,(_,c)=>({'\\':'\\',n:'\n',r:'\r',t:'\t'})[c]));
 for(const v of values)assert.equal(typeof v,'string');
 assert.match(match[4],/^\s*grant select on pg_temp\.event_rpc_input to (static_weekly_control_plane|static_weekly_release_operator|supabase_admin);\s*set local role \1;/);
 assert.match(match[4],/\bselect public\.static_weekly_v3_(register_authority_source|create_draft|materialize_projection)\(/);
 assert.match(match[4],/commit;\s*$/);
 return{create:`create temporary table event_rpc_input(${match[1]}) on commit drop`,
  insert:`insert into pg_temp.event_rpc_input(${columns.join(',')}) values(${columns.map((_,i)=>'$'+(i+1)+'::jsonb').join(',')})`,values,tail:match[4]};
}
async function qualifyCurrentEightTypedInitial({out,input,constructFixture=createCiFreshOnlyFixture}){
 assert.ok(isAbsolute(out)&&isAbsolute(input));assert.equal(fs.existsSync(out),false,'New evidence directory only; no consumed request retry');
 const spec=JSON.parse(fs.readFileSync(input,'utf8'));exact(spec,['schema','constructorMigrations','componentSql','performanceProofSql','historicalReference','approvedReference','recordedRoster','protectedSources']);
 assert.equal(spec.schema,'custodial.current-eight-owned-typed-initial-input.v1');assert.equal(spec.constructorMigrations,302);
 assert.ok(Array.isArray(spec.componentSql));const selected=spec.componentSql.map(r=>relative(B,r.path));
 assert.deepEqual(selected,COMPONENTS,'Exact fourteen-component dependency order (including proof LAST) required');
 assert.equal(new Set(selected).size,selected.length);assert.equal(selected.length+1,14);
 assert.ok(spec.performanceProofSql,'Main must freeze Worker2 performance proof LAST before construction');
 assert.equal(spec.performanceProofSql.path,resolve(B,'proposals/approved-manual-lunch-admission-proof.sql'));
 const allInputs=[...spec.componentSql,spec.performanceProofSql,spec.historicalReference,spec.approvedReference,spec.recordedRoster,...spec.protectedSources];
 const frozenInputs=allInputs.map(ref=>({ref,bytes:readFixed(ref)}));
 assert.ok(spec.protectedSources.some(r=>r.path===resolve(B,'scripts/ci-fresh-only-replay.mjs')));
 assert.ok(spec.protectedSources.some(r=>r.path===resolve(B,'scripts/fixtures/event-static-authority-fixture.mjs')));
 for(const path of [fileURLToPath(import.meta.url),resolve(W,'fixtures/derive-recorded-predecessor.mjs'),
  resolve(B,'scripts/schema-fingerprint-catalog.mjs'),resolve(B,'src/static-weekly-control-plane.js'),resolve(B,'src/approved-manual-coverall-management.js'),
  resolve(B,'src/approved-manual-recurring-transport.js'),resolve(B,'src/approved-manual-period-worker.js')])
  assert.ok(spec.protectedSources.some(r=>r.path===path),'Main must freeze every current driver/native/helper/capture Source, not historical predecessors');
 const protectedPaths=[...new Set(allInputs.map(r=>r.path))].sort(),sourceBefore=sourceSnapshot(protectedPaths);
 fs.mkdirSync(out,{mode:0o700});
 const save=(name,value)=>{assert.match(name,/^[A-Za-z0-9_.-]+$/);const fd=fs.openSync(resolve(out,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);try{fs.writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const sourceCurrent=()=>assert.deepEqual(sourceSnapshot(protectedPaths),sourceBefore,'Adopted protected Source/modes/identities changed');
 const ids={run:randomUUID(),manager:OWNER,credential:randomUUID(),device:randomUUID(),deviceCredential:randomUUID(),
  packet:randomUUID(),source:randomUUID(),version:randomUUID(),templatePublication:randomUUID(),activation:randomUUID(),negativeActivation:randomUUID(),
  employmentRequests:[randomUUID(),randomUUID()],capacityIds:Array.from({length:8},()=>randomUUID()),activationKey:'owned-current-initial:'+randomUUID(),
  launchScope:'CURRENT_EIGHT_PERSON_TYPED_INITIAL_ONLY'};
 save('INTENT_BEFORE_ANY_FIXTURE_OR_SQL_WRITE.json',{scope:'OWNED_CURRENT_SOURCE302_TYPED_EIGHT_INITIAL',ids,inputRef:{path:input,sha256:sha(fs.readFileSync(input)),bytes:fs.statSync(input).size},spec,sourceBefore,productionWritten:false,physicalDevice:false,genuineBrowser:false,finalAppBuild:false,finalAudit:false,EricFinalDecisionRequired:true});
 save('FROZEN_COMPONENT_SQL_AND_DATA_BYTES_BEFORE_WRITE.json',frozenInputs.map(({ref,bytes})=>({ref,encoding:'base64',body:bytes.toString('base64')})));
 let fixture,pool,plane,sequence=0,activeCommand=null,activeOriginalIdentity=null,unknown=false;
 const queries=[],result={status:'RUNNING',scope:'OWNED_CURRENT_EIGHT_TYPED_INITIAL_MANAGER_EMPLOYEE_AND_FULL_HOUR_SQL',productionWritten:false,physicalPhone:false,genuineManagerBrowser:false,providerCalls:0,finalAudit:false,finalBuild:false};
 const intent=(sql,args=[])=>{const n=String(++sequence).padStart(5,'0');activeCommand={sequence,sql,args};save('SQL_'+n+'_BEFORE.json',activeCommand);return n;};
 const setPhase=phase=>{result.phase=phase;save('PHASE_'+String(sequence).padStart(5,'0')+'_'+phase+'.json',{phase,at:new Date().toISOString()});console.log(JSON.stringify({phase}));};
 try{
  sourceCurrent();fixture=await constructFixture({name:'mz_schema_rebuild_atomic302_'+ids.run.replaceAll('-',''),hostSocket:true});
  await fixture.assertOwned();assert.equal(fixture.receipt.selected_replay.migrations,302);assert.equal(fixture.receipt.full_suite_PASS,false);save('FRESH_CURRENT_SOURCE302_CONSTRUCTION_ONLY.json',fixture.receipt);
  pool=new pg.Pool({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres',max:2,connectionTimeoutMillis:5000});
  const query=async(sql,args=[])=>{assert.equal(unknown,false,'Unknown transaction state forbids another SQL command');await fixture.assertOwned();const n=intent(sql,args);try{const r=await pool.query(sql,args);queries.push({sequence,returned:true});save('SQL_'+n+'_RETURNED.json',{rowCount:r.rowCount??null,command:r.command??null});return r;}catch(e){save('SQL_'+n+'_ERROR.json',{code:e.code??null,message:e.message,where:e.where??null});throw e;}};
  const tx=async(role,work)=>{assert.equal(unknown,false,'Unknown transaction state forbids another SQL transaction');assert.ok(['supabase_admin','static_weekly_release_operator','static_weekly_control_plane','custodial_application_reader','anon','authenticated','service_role'].includes(role));await fixture.assertOwned();const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);const r=await work(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{unknown=true;});throw e;}finally{c.release();}};
  const rpc=(role,name,args=[])=>{assert.match(name,/^(public|custodial_employment)\.[a-z_0-9]+$/);const text=`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`;intent(text,args);return tx(role,async c=>(await c.query(text,args)).rows[0].value);};
  const revision=async()=>Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
  const rejected=async(label,fn,code=null)=>{let failure;try{await fn();}catch(e){failure=e;}if(failure&&(unknown||/UNKNOWN|custody_unknown|outcome_unknown/i.test(String(failure.code??''))||/^(08|ECONN|57P)/.test(String(failure.code??'')))){unknown=true;throw failure;}assert.ok(failure,label+' must refuse');if(code)assert.equal(failure.code,code,label);save('NEGATIVE_'+label+'.json',{label,code:failure.code??null,message:failure.message});};
  setPhase('verify_current302_already_contains_all14_components');
  const currentMigration=fs.readFileSync(resolve(B,'supabase/migrations/20261031125902_approved_manual_native_operations.sql'),'utf8');
  for(const ref of [...spec.componentSql,spec.performanceProofSql]){readFixed(ref);assert.ok(currentMigration.includes('SHA256 '+ref.sha256),'Current macro must bind each exact component');}
  const owner=(await query('select manager_id,display_name,roles,active,is_system_principal,revoked_at,system_key from public.ops_manager_managers where manager_id=$1',[OWNER])).rows[0];
  assert.ok(owner&&owner.active===true&&owner.is_system_principal===false,'Original seeded owner0001 required; no manager creation/promotion');
  await query("insert into public.ops_manager_trusted_devices(credential_id,manager_id,device_id,device_label,token_hash,max_access_level,created_at,expires_at) values($1,$2,$3,'Synthetic owned atomic initial SQL qualification',repeat('c',64),'full_access',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day')",[ids.credential,OWNER,'owned-atomic302-'+ids.run]);
  const manager=projectManagerSession({manager_id:OWNER,manager_display_name:owner.display_name,auth_mode:'trusted_device',trusted_device:true,read_only:false,credential_id:ids.credential,device_id:'owned-atomic302-'+ids.run,access_level:'full_access'},owner,{maximumAccessLevel:'full_access',credentialBound:true});
  assert.equal(manager.permissions.owner,true);assert.equal(manager.read_only,false);
  const realActor=await rpc('static_weekly_control_plane','public.custodial_action_actor_v1',[OWNER,ids.credential,manager.device_id,'full_access','write']);assert.equal(realActor.owner,true);save('ACTUAL_SEEDED_OWNER_BOUND_SYNTHETIC_CREDENTIAL.json',{manager,realActor,synthetic:true});
  setPhase('construct_genuine_historical_reference_parent');
  const week=readApprovedManualWeek(),rawReference=readFixed(spec.historicalReference),reference=validateFullNineV6FixtureBytes(rawReference),recorded=JSON.parse(readFixed(spec.recordedRoster)).readback;
  assert.equal(spec.historicalReference.sha256,'a1b43408c9b61ba4bb93ae3d0f78dcab3efdde9ffd4fa7a945005d2ae045ab04');assert.equal(recorded.rosterSlots.length,22);
  const at=(await query('select public.sch_service_date(statement_timestamp())::text date')).rows[0].date;
  const previousMonday=eventAuthorityWeekStart(addDays(at,-1));assert.ok(previousMonday<at);
  const {seed,transformation}=deriveOriginal314RecordedPredecessor({fixture:reference,recorded,anchorCivilDate:at});
  assert.equal(seed.serviceDate,previousMonday);assert.equal(seed.versions[0].assignments.length,314);
  save('HISTORICAL_PREDECESSOR_INPUT_BEFORE_WRITE.json',{scope:'SYNTHETIC_HISTORICAL_FIXTURE_DERIVED_FROM_EXACT_ORIGINAL314_AND_RECORDED22_HISTORY',rawReference:spec.historicalReference,recordedRoster:spec.recordedRoster,serviceDate:previousMonday,source:seed,originalDuties:314,approved346PatternNotPublished:true,transformation,noInventedAttestation:true});
  const people=new Map(seed.slots.flatMap(s=>s.incumbencies).map(r=>[r.personId,r]));for(const row of recorded.employees)people.set(row.employeeId,{personId:row.employeeId,displayName:row.displayName});
  let number=800;for(const p of people.values()){const known=recorded.employees.find(e=>e.employeeId===p.personId),code=known?.employeeCode??'EMP'+(++number);
   await query("insert into public.employees(id,employee_code,display_name,role,active) values($1,$2,$3,'staff',true)",[p.personId,code,p.displayName]);
   await query("insert into public.msg_users(employee_id,display_name,role,is_active) values($1,$2,'employee',true)",[p.personId,p.displayName]);}
  const baseVersion=seed.versions[0],approvedReferenceBytes=readFixed(spec.approvedReference);
  assert.equal(spec.approvedReference.path,resolve(B,week.referenceBindings.reference.path));
  assert.equal(spec.approvedReference.sha256,week.referenceBindings.reference.sha256);assert.equal(spec.approvedReference.bytes,week.referenceBindings.reference.bytes);
  const approvedReference=JSON.parse(approvedReferenceBytes),approvedCatalogVersion=approvedReference.template.source.version,
   locations=new Map(),groups=new Map(),snapshotDifferences=[];
  // Only exact IDs/memberships in these two pinned sources. Current approved
  // names win current directory labels; old314 Source snapshots stay literal.
  for(const [origin,version]of [['HISTORICAL314',baseVersion],['APPROVED_CORRECTION_REFERENCE',approvedCatalogVersion]])for(const a of version.assignments){
   const binding=week.referenceBindings.groups.find(g=>g.referenceCode===a.locationCodeSnapshot),prior=groups.get(a.locationCodeSnapshot),primary=binding?.primaryLocationId??a.locationId;
   if(prior&&(prior.name!==a.locationNameSnapshot||prior.id!==a.locationId))snapshotDifferences.push({kind:'HISTORICAL_GROUP_SNAPSHOT',sourceLocationId:a.locationId,currentPrimary:primary,sourceName:a.locationNameSnapshot,code:a.locationCodeSnapshot,origin});
   const members=new Map((prior?.locations??[]).map(l=>[l.locationId,l]));
   for(const l of [{locationId:a.locationId,locationNameSnapshot:a.locationNameSnapshot},...(a.includedLocations??[]),...(binding?.includedLocations??[])]){
    members.set(l.locationId,l);const old=locations.get(l.locationId);if(old&&old.locationNameSnapshot!==l.locationNameSnapshot)snapshotDifferences.push({kind:'LOCATION_SNAPSHOT',id:l.locationId,prior:old,current:l,origin});locations.set(l.locationId,l);
   }
   groups.set(a.locationCodeSnapshot,{id:primary,code:a.locationCodeSnapshot,name:binding?.referenceLabel??a.locationNameSnapshot,locations:[...members.values()]});
  }
  save('EXACT_TWO_SOURCE_CATALOG_UNION_BEFORE_WRITE.json',{historical:spec.historicalReference,approved:spec.approvedReference,groups:[...groups.values()],locations:[...locations.values()],snapshotDifferences,historicalSourceRewritten:false,inventedIds:false});
  for(const [id,l]of locations)await query("insert into public.locations(id,location_code,location_name,location_type,form_type) values($1,$2,$3,'restroom','restroom')",[id,'FIXTURE-'+id,l.locationNameSnapshot]);
  for(const g of groups.values()){await query('insert into public.location_groups(id,group_code,group_name) values($1,$2,$3)',[g.id,g.code,g.name]);for(const l of g.locations)await query('insert into public.location_group_memberships(location_group_id,location_id) values($1,$2)',[g.id,l.locationId]);}
  const nativeHelperPort=async statement=>{assert.equal(unknown,false,'Unknown transaction state forbids another predecessor SQL command');await fixture.assertOwned();const n=intent(statement);const c=await pool.connect();try{
   let rows;const copied=copiedPort(statement);
   if(copied){await c.query('begin');await c.query(copied.create);await c.query(copied.insert,copied.values);const answer=await c.query(copied.tail);rows=(Array.isArray(answer)?answer: [answer]).findLast(r=>r.rows?.length)?.rows;}
   else{assert.equal(statement.includes('copy pg_temp.event_rpc_input'),false,'Unknown helper COPY grammar refused');const answer=await c.query(statement);rows=(Array.isArray(answer)?answer:[answer]).findLast(r=>r.rows?.length)?.rows;}
   assert.ok(rows?.length===1);const value=Object.values(rows[0]);assert.equal(value.length,1);save('SQL_'+n+'_RETURNED.json',{returned:true,nativeBoundJsonPort:!!copied});return typeof value[0]==='string'?value[0]:JSON.stringify(value[0]);
  }catch(e){await c.query('rollback').catch(()=>{unknown=true;});throw e;}finally{let resetError;try{await c.query('reset role');}catch(e){unknown=true;resetError=e;}c.release(resetError);if(resetError)throw resetError;}};
  installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
  const historical=await seedCompiledEventAuthority({sql:nativeHelperPort,container:fixture.name,managerId:OWNER,dates:[previousMonday],label:'owned-historical-before-atomic302-'+ids.run,source:seed,mode:'official'});
  save('ACTUAL_HISTORICAL_OFFICIAL_PARENT.json',{sourceId:historical.sourceId,versionId:historical.versionId,publicationId:historical.publicationId,projectionIds:historical.projectionIds,envelopes:historical.envelopes,compiled:historical.compiledByWeek,scope:'Genuine official fixture computation/publication, not current approved baseline or physical proof'});
  assert.equal(Number((await query('select count(*) n from public.weekly_roster_slots')).rows[0].n),22);
  const counts=async()=>(await query("select (select count(*)::int from public.employees) people,(select count(*)::int from public.msg_users) messengers,(select count(*)::int from public.weekly_roster_slots) slots,(select count(*)::int from public.static_weekly_staffing_absences) absences")).rows[0];
  const historicalRows=(await query('select to_jsonb(s) value from public.weekly_roster_slots s order by slot_id')).rows;save('ORIGINAL22_ROSTER_ROWS.json',historicalRows);
  setPhase('admit_actual_two_dated_employment_facts');
  const employmentData=readOwnerConfirmedEmploymentAdmissionData(),rev=await revision(),commands=employmentData.employees.map((e,i)=>prepareApprovedManualEmploymentAdmission({employeeId:e.employeeId,requestId:ids.employmentRequests[i],managerId:OWNER,expectedAuthorityRevision:rev,expectedEmploymentRevision:0}).command);
  save('TWO_EMPLOYMENT_COMMANDS_BEFORE_WRITE.json',commands);const admissions=[];
  for(const cmd of commands)admissions.push(await rpc('static_weekly_control_plane','custodial_employment.admit',[cmd,ids.credential,manager.device_id,'full_access']));save('ACTUAL_TWO_EMPLOYMENT_ADMISSIONS.json',admissions);assert.equal(await revision(),rev);
  await rejected('read_only_employment',()=>rpc('static_weekly_control_plane','custodial_employment.admit',[commands[0],ids.credential,manager.device_id,'read_only']),'42501');
  const acl=(await query("select n.nspname,c.relname,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') authenticated,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') service_role from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind='r'")).rows;
  assert.ok(acl.length>0&&acl.every(r=>!r.anon&&!r.authenticated&&!r.service_role));save('ACTUAL_PRIVATE_ACL_NEGATIVES.json',acl);
  plane=createStaticWeeklyControlPlane({database:{connect:async()=>{await fixture.assertOwned();return pool.connect();}}});
  const run=fn=>plane.runManagerOperation({manager,signal:new AbortController().signal,deadlineAt:performance.now()+120000,permission:'write'},fn);
  const snapshot=await run(()=>plane.getApprovedManualActivationRoster({manager}));assert.equal(snapshot.rosterSlots.length,22);assert.equal(snapshot.serviceDate,at);
  save('ACTUAL_CURRENT_ACTIVATION_ROSTER_BEFORE_PACKET.json',snapshot);
  const draft=prepareApprovedManualSourceDraft({week,referenceBytes:approvedReferenceBytes});const selection=draft.sourceDraft.slots.filter(s=>s.contractorCapacity).map((s,i)=>({legacy_slot_id:s.id,new_capacity_id:ids.capacityIds[i],capacity_code:'CoverAll'+String(i+1).padStart(2,'0')}));assert.equal(selection.length,8);
  const packet=prepareApprovedManualCoverAllActivation({week,draft,snapshot,selection,sourceId:ids.source,versionId:ids.version,templatePublicationId:ids.templatePublication,templateId:'owned-current-'+ids.run,packetId:ids.packet,managerId:OWNER});
  save('CURRENT_DATE_APPROVED_PACKET_BEFORE_WRITE.json',packet);assert.equal(packet.feasibility.projectionAssignments.length,346);assert.equal(packet.feasibility.lunch.lunches.length,40);assert.equal(packet.feasibility.solverInvoked,false);
  const prepared=await rpc('static_weekly_release_operator','public.static_weekly_prepare_coverall_activation',[packet]);save('ACTUAL_PACKET_PREPARATION.json',prepared);
  const preview=await run(()=>plane.previewApprovedManualActivation({manager,packetId:ids.packet,expectedRevision:snapshot.authorityRevision}));save('ACTUAL_V2_PREVIEW.json',preview);assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.employmentRevisionVector.length,14);
  for(const role of ['anon','authenticated','service_role'])await rejected('activation_role_'+role,()=>rpc(role,'public.static_weekly_prepare_coverall_activation',[packet]),'42501');
  const before=await counts(),badInput={manager,packetId:ids.packet,operationId:ids.negativeActivation,expectedRevision:snapshot.authorityRevision,previewDigest:'0'.repeat(64),idempotencyKey:'negative-'+ids.run};save('NEGATIVE_ACTIVATION_BEFORE_WRITE.json',badInput);
  await rejected('changed_preview',()=>run(()=>plane.activateApprovedManualSchedule(badInput)));assert.deepEqual(await counts(),before,'Rejected initial request must not half-register capacity or employees');
  const request={manager,packetId:ids.packet,operationId:ids.activation,expectedRevision:snapshot.authorityRevision,previewDigest:preview.previewDigest,idempotencyKey:ids.activationKey};save('ORIGINAL_ACTIVATION_REQUEST_BEFORE_WRITE.json',request);
  setPhase('one_atomic_native_initial_activation');
  activeOriginalIdentity={kind:'CURRENT_EIGHT_TYPED_INITIAL',operationId:ids.activation,request};
  const accepted=await run(()=>plane.activateApprovedManualSchedule(request));save('ACTUAL_V2_ACTIVATION_RETURNED_AFTER_COMMIT.json',accepted);
  assert.equal(accepted.status,'PERSISTED_CURRENT');assert.equal(accepted.operationId,ids.activation);assert.equal(accepted.samePhysicalTransaction,true);assert.equal(accepted.normalPatternSolverInvoked,false);assert.equal(accepted.actualPositions,30);assert.equal(accepted.newEmployeesCreated,false);assert.equal(accepted.weeklyBaselineChanged,false);assert.equal(accepted.employmentRevisionVector.length,14);
  const after=await counts();assert.equal(after.people,before.people);assert.equal(after.messengers,before.messengers);assert.equal(after.slots,30);assert.equal(after.absences,before.absences,'Pre-start creates no PTO/absence rows');
  const original=(await query('select to_jsonb(s) value from public.weekly_roster_slots s where not(slot_id=any($1::uuid[])) order by slot_id',[ids.capacityIds])).rows;assert.deepEqual(original,historicalRows,'Original22 positions unchanged');
  const capacity=(await query('select s.slot_id,(select count(*)::int from public.weekly_roster_slot_incumbencies i where i.slot_id=s.slot_id) incumbencies,(select count(*)::int from public.employees e where e.id=s.slot_id) employees from public.weekly_roster_slots s where s.slot_id=any($1::uuid[])',[ids.capacityIds])).rows;assert.equal(capacity.length,8);assert.ok(capacity.every(r=>r.incumbencies===0&&r.employees===0));save('ACTUAL_EIGHT_NONEMPLOYEE_POSITIONS.json',capacity);
  const txProof=(await query('select o.owner_xid::text operation_xid,p.owner_xid::text progress_xid,p.backend_pid,(s.xmin)::text stage_xmin,(r.xmin)::text receipt_xmin,r.receipt_json from custodial_coverall.activation_operations o join custodial_coverall.activation_progress p using(operation_id) join custodial_coverall.initial_operational_stages s using(operation_id) join custodial_coverall.activation_receipts r using(operation_id) where operation_id=$1',[ids.activation])).rows[0];assert.ok(txProof);assert.equal(txProof.operation_xid,txProof.progress_xid);assert.equal(BigInt(txProof.stage_xmin),BigInt(txProof.operation_xid)%4294967296n);assert.equal(txProof.receipt_xmin,txProof.stage_xmin);save('ACTUAL_SAME_PHYSICAL_TRANSACTION_SQL_WITNESS.json',txProof);
  const baselineProjection=accepted.normalBaselineResult?.projection_id;assert.match(baselineProjection,UUID);assert.notEqual(baselineProjection,accepted.projectionId);
  const immutableNormal=(await query(`select jsonb_array_length(p.projection_envelope->'assignments') assignments,jsonb_array_length(l.document_json->'loans') lunches,s.canonical_source#>'{version,assignments}' source_assignments,s.canonical_source#>'{version,lunchCoveragePolicy}' source_lunch_policy
   from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
   join public.weekly_schedule_versions v using(version_id) join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id where p.projection_id=$1`,[baselineProjection])).rows[0];
  assert.ok(immutableNormal);assert.equal(immutableNormal.assignments,346);assert.equal(immutableNormal.lunches,40);
  assert.deepEqual(immutableNormal.source_assignments,packet.source.version.assignments);assert.deepEqual(immutableNormal.source_lunch_policy,packet.source.version.lunchCoveragePolicy);
  save('ACTUAL_IMMUTABLE346_40_BASELINE_SEPARATE_FROM_CURRENT_OPERATIONAL.json',{baselineProjection,...immutableNormal,normalBaselineIsNotActualCoverage:true});
  const current=(await query('select p.projection_envelope,l.document_json,l.document_identity from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id=$1',[accepted.projectionId])).rows[0];assert.ok(current);assert.equal(current.projection_envelope.semantic_snapshot.initialActivation.operationId,ids.activation);assert.deepEqual(current.projection_envelope.authority.employmentRevisionVector,accepted.employmentRevisionVector);
  for(const l of current.document_json.loans){const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));assert.equal(minute(l.coverage_end)-minute(l.coverage_start),60);assert.equal(l.helper_slot_ids.length,1);assert.equal(l.fallback,null);}save('ACTUAL_CURRENT_PROJECTION_AND_FULL_HOUR_LUNCH.json',current);
  const basis=(await query('select basis_json from custodial_coverall.activation_progress where operation_id=$1',[ids.activation])).rows[0].basis_json;assert.equal(basis.employmentByDate.length,7);assert.equal(basis.employmentRevisionVector.length,14);save('ACTUAL_SEVEN_EMPLOYMENT_READS_AND_14_BINDINGS.json',{employmentByDate:basis.employmentByDate,employmentRevisionVector:basis.employmentRevisionVector});
  for(const row of current.projection_envelope.assignments){const day=basis.employmentByDate.find(d=>d.serviceDate===row.service_date);assert.ok(day);for(const e of day.employees){const f=e.command.fact;if(f.state==='PRE_START'||row.service_date<f.firstServiceDate)assert.notEqual(row.owner_person_id,e.employeeId);}}
  const managerView=await run(()=>plane.getManagerSnapshot({manager,weekStart:at}));assert.equal(managerView.projection_status,'current');assert.equal(managerView.latest_projection.projection_id,accepted.projectionId);save('ACTUAL_CURRENT_MANAGER_READ.json',managerView);
  const dayReads=[];for(let d=0;d<7;d++){const day=addDays(at,d),person=week.referenceBindings.people.find(p=>current.projection_envelope.assignments.some(r=>r.service_date===day&&r.owner_person_id===p.employeeId));assert.ok(person);const view=await rpc('custodial_application_reader','public.static_weekly_v5_read_employee_day',[day,person.employeeId,day+'T15:00:00Z']);assert.equal(view.projection_status,'current');assert.equal(view.projection_id,accepted.projectionId);dayReads.push({day,employeeId:person.employeeId,view});}save('ACTUAL_EMPLOYEE_SQL_READS.json',dayReads);
  const physicalSqlRows=[];for(let d=0;d<7;d++){const day=addDays(at,d),rows=await tx('custodial_application_reader',c=>c.query('select * from public.custodial_operational_location_assignments($1::date)',[day]));assert.ok(rows.rows.length>0);for(const r of rows.rows){const subject=basis.employmentByDate.find(x=>x.serviceDate===day).employees.find(e=>e.employeeId===r.assigned_employee_id);if(subject&&(subject.command.fact.state==='PRE_START'||day<subject.command.fact.firstServiceDate))assert.fail('Pre-start employee exposed as actual SQL location owner');}physicalSqlRows.push({day,rows:rows.rows});}save('ACTUAL_OPERATIONAL_LOCATION_SQL_READS_NOT_PHYSICAL.json',physicalSqlRows);
  assert.equal(current.document_json.loans.length,40);
  assert.ok(!current.projection_envelope.authority.projectionAvailability.some(row=>row.unavailabilityClassification==='PRE_START_NOT_PTO'));
  let employeeDayReadbacks=0,ownershipChecks=0;
  const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  for(const entry of physicalSqlRows){const approved=week.days.find(day=>day.weekday===new Date(entry.day+'T12:00Z').getUTCDay());
   for(const person of approved.employees){const id=week.referenceBindings.people.find(p=>p.approvedName===person.name).employeeId,view=await rpc('custodial_application_reader','public.static_weekly_v5_read_employee_day',[entry.day,id,entry.day+'T15:00:00Z']);assert.equal(view.projection_status,'current');assert.equal(view.projection_id,accepted.projectionId);employeeDayReadbacks++;}
   for(let atMinute=minute(approved.checkedWindow.start);atMinute<minute(approved.checkedWindow.end);atMinute++){
    const expected=previewApprovedManualDay(week,{day:approved.day,time:time(atMinute)});
    for(const owner of expected.owners){const group=week.referenceBindings.groups.find(g=>g.referenceCode===owner.locationCode);if(group.retainedServiceModes[0]!=='scan_tracked')continue;
     for(const member of group.includedLocations){const actual=entry.rows.filter(r=>r.location_id===member.locationId&&minute(r.coverage_start)<=atMinute&&atMinute<minute(r.coverage_end));assert.deepEqual(actual.map(r=>r.assigned_employee_id),[owner.employeeId]);ownershipChecks++;}}
   }
  }
  assert.equal(employeeDayReadbacks,40);sourceCurrent();
  Object.assign(result,{status:'PASS',currentDate:at,publicationId:accepted.publicationId,projectionId:accepted.projectionId,activationOperation:ids.activation,original22Preserved:true,actualSlots30:true,newEmployeeRows0:true,allEightActiveForSchedule:true,firstWorkdayExclusions:0,fullHourLunches:40,employeeDayReadbacks,ownershipChecks,actualCredentialBoundManagerSQL:true,samePhysicalTransaction:true,normalSevenSourcesChanged:false,productionWritten:false,physicalDelivery:false,canonicalSource302Qualified:false});
 }catch(e){unknown=unknown||/^(08|ECONN|57P)/.test(String(e.code??''))||/UNKNOWN|custody_unknown|outcome_unknown/i.test(String(e.code??''))||e.coverAllOriginalTransactionState==='UNKNOWN';Object.assign(result,{status:unknown?'UNKNOWN':'FAIL',failedPhase:result.phase,code:e.code??null,message:String(e.message).slice(0,1800),where:String(e.where??e.cause?.where??'').slice(0,5000),position:e.position??null,internalPosition:e.internalPosition??null,internalQuery:e.internalQuery??null,originalOperationId:activeOriginalIdentity?.operationId??ids.activation,activeOriginalIdentity,retry:false,activeCommandSequence:activeCommand?.sequence??null});process.exitCode=1;}
 finally{
  try{await shutdownStaticWeeklyCompiler();}catch(e){unknown=true;result.compilerCleanupError=e.message;result.status='UNKNOWN';process.exitCode=1;}
  if(plane?.close)try{await plane.close();}catch(e){unknown=true;result.planeCleanupError=e.message;result.status='UNKNOWN';process.exitCode=1;}
  if(pool)try{await pool.end();}catch(e){unknown=true;result.poolCleanupError=e.message;result.status='UNKNOWN';process.exitCode=1;}
  try{sourceCurrent();result.protectedSourcesPreserved=true;}catch(e){result.status='FAIL';result.sourcePreservationError=e.message;process.exitCode=1;}
  if(fixture&&(unknown||result.status!=='PASS')){
   result.cleanup=unknown?'PRESERVED_ORIGINAL_OWNED_FIXTURE_FOR_UNKNOWN_RECONCILIATION':'PRESERVED_ORIGINAL_OWNED_FIXTURE_AFTER_FAILED_COMPONENT_FLOW';
   save(unknown?'UNKNOWN_ORIGINAL_FIXTURE_PRESERVED.json':'FAILED_ORIGINAL_FIXTURE_PRESERVED.json',{
    status:result.status,phase:result.phase,failedPhase:result.failedPhase??null,unknown,
    receipt:fixture.receipt,ids,originalOperationId:activeOriginalIdentity?.operationId??ids.activation,activeOriginalIdentity,
    activeCommandSequence:activeCommand?.sequence??null,inputPath:input,originalSpecification:spec,sourceRefs:allInputs,
    protectedSourcesPreserved:result.protectedSourcesPreserved??false,
    shutdownCallsSettled:true,compilerShutdownReturned:!result.compilerCleanupError,
    planeCloseReturned:plane?.close?!result.planeCleanupError:null,poolEndReturned:pool?!result.poolCleanupError:null,
    componentQualificationOnly:true,freshSource302Construction:true,fullSuitePASS:false,
    automaticAdoption:false,automaticResume:false,automaticRetry:false,
    MainExplicitOwnedCustodyReviewRequiredBeforeAnyFurtherOperation:true});
  }
  else if(fixture)try{await fixture.assertOwned();await fixture.cleanup();result.cleanup='SUPPORTED_ORIGINAL_OWNED_FIXTURE_CLEANUP_RETURNED';}catch(e){result.status='UNKNOWN';result.cleanup='UNRESOLVED';result.cleanupError=e.message;process.exitCode=1;}
  else result.cleanup='NO_RETURNED_FIXTURE_CONSTRUCTOR_OWNS_ITS_PARTIAL_CLEANUP';
  save('SOURCE_AFTER.json',sourceSnapshot(protectedPaths));save('RESULT.json',{...result,ids,directPoolQueriesReturned:queries.length,sqlCommandIntents:sequence,finishedAt:new Date().toISOString(),noAutomaticRetry:true});console.log(JSON.stringify(result));
 }
 return result;
}
export async function runApprovedManualActivationDatabaseTest({out,constructFixture=createCiFreshOnlyFixture,constructorMigrationCount=302}){
 assert.equal(constructorMigrationCount,302);assert.ok(isAbsolute(out));
 const ref=path=>{const raw=fs.readFileSync(path);return {path,sha256:sha(raw),bytes:raw.length};};
 const week=readApprovedManualWeek(),required=[fileURLToPath(import.meta.url),resolve(W,'fixtures/derive-recorded-predecessor.mjs'),resolve(B,'scripts/ci-fresh-only-replay.mjs'),resolve(B,'scripts/fixtures/event-static-authority-fixture.mjs'),resolve(B,'scripts/schema-fingerprint-catalog.mjs'),resolve(B,'src/static-weekly-control-plane.js'),resolve(B,'src/approved-manual-coverall-management.js'),resolve(B,'src/approved-manual-recurring-transport.js'),resolve(B,'src/approved-manual-period-worker.js'),resolve(B,'src/approved-manual-employment-admission.js'),resolve(B,'src/approved-manual-employment-integration.js'),resolve(B,'release/worker1-employment-admission-20261030/OWNER_APPROVED_EIGHT_ACTIVE_20261031.json')];
 const spec={schema:'custodial.current-eight-owned-typed-initial-input.v1',constructorMigrations:302,componentSql:COMPONENTS.map(p=>ref(resolve(B,p))),performanceProofSql:ref(resolve(B,'proposals/approved-manual-lunch-admission-proof.sql')),historicalReference:ref(resolve(B,'scripts/fixtures/full-nine-v6-source.json')),approvedReference:ref(resolve(B,week.referenceBindings.reference.path)),recordedRoster:ref(resolve(B,'scripts/fixtures/manual-live-roster-20261030.json')),protectedSources:required.map(ref)};
 const input=out+'.INPUT.json';fs.mkdirSync(dirname(out),{recursive:true});fs.writeFileSync(input,JSON.stringify(spec,null,2)+'\n',{flag:'wx',mode:0o600});
 return qualifyCurrentEightTypedInitial({out,input,constructFixture});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert.equal(args.length,2);assert.equal(args[0],'--out');
 const result=await runApprovedManualActivationDatabaseTest({out:resolve(args[1])});if(result.status!=='PASS')process.exitCode=1;
}
