// Actual named-manager HTTP -> checked-out SQL transaction -> compiler/verifier
// -> existing publication/projection/lunch -> exact receipt. Disposable only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
const container=`mz_schema_rebuild_place_names_${process.pid}`,db='postgres';
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
let database='postgres',owned=false,server,authorityDb,admin,cp,checks=0,preAdoptionCore;
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d',database],{input:'set client_min_messages=warning;'+text}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;if(!name.startsWith('absent defaults')&&!name.startsWith('unchanged tested source'))console.log('PASS',name);};
const reject=(name,query,pattern)=>{let error;try{sql(query);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;};
const hash=v=>createHash('sha256').update(v).digest('hex');
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{if(owned)docker(['rm','-f',container]);}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);docker(['run','--rm','-d','--name',container,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres',image,'-c','listen_addresses=*','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c',`cron.database_name=${db}`]);owned=true;console.log('OWNED_CONTAINER',container);
 let ready=0;for(let i=0;i<100&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,5);
 // The preserved October predecessor hash is captured against the supported
 // Supabase postgres database, not a newly invented schema/search-path setup.
 database=db;removeDefaults();
 const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=new Map();
 for(const file of files){check('absent defaults before '+file,sql(defaults),'0');const bytes=readFileSync('supabase/migrations/'+file);manifest.set(file,hash(bytes));
  if(file==='20261003030000_place_operational_name_adoption.sql')preAdoptionCore=sql("select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by oid::regprocedure::text)) from pg_proc where pronamespace='public'::regnamespace and proname in('tool_start_offline_occurrence','tool_finish_session','tool_complete_session','tool_commit_cleaning_workflow_authoritative','custodial_start_offline_occurrence')");
  try{sql(bytes.toString());}catch(e){console.error('FAILED_MIGRATION',file,String(e.stderr));throw e;}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  check('absent defaults after '+file,sql(defaults),'0');await new Promise(r=>setImmediate(r));
 }
 console.log('EXACT_REPLAY_COMPLETE',files.length);
 const manager=randomUUID(),otherManager=randomUUID();sql(`insert into public.ops_manager_managers(manager_id,display_name,roles) values(${q(manager)},'Synthetic selected-place manager',array['OPS_MANAGER','CUSTODIAL_MANAGER']),(${q(otherManager)},'Synthetic second manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'])`);
 const week=sql("select date_trunc('week',clock_timestamp() at time zone 'America/Chicago')::date::text"),next=new Date(Date.parse(week+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const fixture=nativeLocationAuthoritySource(week,1),{source,slots,places}=fixture;
 const template=structuredClone(source.versions[0]);source.versions[0].slotAvailability=Array.from({length:7},(_,day)=>template.slotAvailability.map(x=>({...x,dayOfWeek:day}))).flat();
 source.versions[0].assignments=Array.from({length:7},(_,day)=>template.assignments.map(x=>({...x,dayOfWeek:day,workId:`${x.workId}-${day}`}))).flat();
 for(const [i,s] of slots.entries())sql(`insert into public.employees(id,employee_code,display_name,role) values(${q(s.person)},'EMP_PLACE_TEST_${i}',${q(s.name)},'staff')`);
 for(const p of Object.values(places))sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,nfc_url,scan_router_url) values(${q(p.id)},${q(p.code)},${q(p.name)},'restroom','restroom','synthetic-original-tag','synthetic-original-router');
  insert into public.location_groups(id,group_code,group_name) values(${q(p.group)},${q(p.code)},${q(p.name)});insert into public.location_group_memberships(location_group_id,location_id) values(${q(p.group)},${q(p.id)});`);
 const authority=await seedCompiledEventAuthority({sql,container,database:db,managerId:manager,dates:[week],source,label:'place-names'});
 const before=sql("select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by oid::regprocedure::text)) from pg_proc where pronamespace='public'::regnamespace and proname in('tool_start_offline_occurrence','tool_finish_session','tool_complete_session','tool_commit_cleaning_workflow_authoritative','custodial_start_offline_occurrence')");
 check('forward migration preserves exact predecessor Start/Finish bytes',before,preAdoptionCore);
 const rawBefore=sql("select md5(jsonb_agg(to_jsonb(l) order by id)::text) from public.locations l");
 const enroll=(kind,id,code,name)=>{const p=JSON.parse(sql(`set role service_role;select public.custodial_place_source_preview(${q(manager)},${q(kind)},${q(id)},'enroll',${j({canonical_code:code,display_name:name,aliases:[kind+' human alias'],cleaning_mode:'SCAN_TRACKED',event_eligible:false})},null,'Explicit synthetic name enrollment');`));
  return JSON.parse(sql(`set role service_role;select public.custodial_place_source_confirm(${q(randomUUID())},${q(manager)},${q(p.preview_id)});`));};
 const physical=places.W.id,group=places.W.group;
 const handset=randomUUID(),phoneCredential=randomUUID(),handsetCode='PLACE_PROTECTED_SYNTHETIC_PHONE';
 const executionSecret='isolated-place-execution-proof-not-production',routeSecret='isolated-place-native-route-proof-not-production';
 sql(`select public.custodial_configure_backend_execution_key(${q(hash(executionSecret))},'Synthetic Place compatibility fixture');
 select public.custodial_configure_native_route_proof_key(${q(hash(routeSecret))},'Synthetic Place compatibility fixture');
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(handset)},${q(handsetCode)},'Synthetic original phone',true,${q(slots[0].person)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(phoneCredential)},${q(handset)},repeat('c',64),now(),now()+interval '2 days');
 insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
 values(${q(handset)},${q(handsetCode)},${q(slots[0].person)},${q(slots[0].name)},'Synthetic preserved assignment','test');`);
 const snapshot=JSON.parse(sql(`set role service_role;select public.tool_get_offline_scan_authority_snapshot(${q(handsetCode)},${q(phoneCredential)},${q(executionSecret)})`));
 const originalSnapshot=sql(`select to_jsonb(s)::text from public.custodial_offline_scan_authority_snapshots s where snapshot_id=${q(snapshot.snapshot_id)}`);
 const savedStart={session:randomUUID(),scan:randomUUID(),started:new Date(Date.parse(snapshot.generated_at)+1).toISOString()};
 check('original snapshot interval remains24h',Date.parse(snapshot.expires_at)-Date.parse(snapshot.generated_at),86400000);
 enroll('physical_location',physical,'PLACE_TEST_PHYSICAL','Accepted renamed physical');enroll('location_group',group,'PLACE_TEST_GROUP','Accepted renamed group');
 const selected=[{legacy_kind:'physical_location',legacy_id:physical,revision:1},{legacy_kind:'location_group',legacy_id:group,revision:1}];
 check('metadata alone leaves actual scan label untouched',sql(`set role service_role;select public.place_operational_location_name(${q(physical)},clock_timestamp())`),places.W.name);
 const port=Number(docker(['port',container,'5432/tcp']).trim().split(':').at(-1));
 sql("alter role supabase_admin password 'synthetic-place-admin-only';create role place_names_runtime login password 'synthetic-place-names-only';grant static_weekly_control_plane to place_names_runtime");
 // Test-only pool to the exact owned container. Production TLS/configuration
 // constructor is unchanged and covered by its existing standalone tests.
 authorityDb=new Pool({connectionString:`postgresql://place_names_runtime:synthetic-place-names-only@127.0.0.1:${port}/${db}`,ssl:false});
 const connect=authorityDb.connect.bind(authorityDb),observed=new WeakSet();authorityDb.connect=async()=>{const client=await connect();if(!observed.has(client)){observed.add(client);const query=client.query.bind(client);client.query=async(...args)=>{try{return await query(...args);}catch(e){console.error('LOCAL_CONTROL_PLANE_SQL_FAILED',e.code,e.message,e.detail);throw e;}};}return client;};
 admin=new Pool({connectionString:`postgresql://supabase_admin:synthetic-place-admin-only@127.0.0.1:${port}/${db}`,ssl:false});cp=createStaticWeeklyControlPlane({database:authorityDb});
 const env={NODE_ENV:'test',SUPABASE_URL:'https://synthetic-place.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-a-real-key',OPS_MANAGER_SESSION_SECRET:'synthetic-selected-place-http-session-secret'};
 const credential=randomUUID(),device='PLACE_NAME_MANAGER_TEST';let currentManager=manager;
 const trusted={find:async id=>{if(id!==credential)return null;const {rows}=await admin.query('select manager_id,display_name,roles,active from public.ops_manager_managers where manager_id=$1',[currentManager]);
  return {credential_id:credential,device_id:device,max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),manager_id:currentManager,manager:rows[0]};}};
 const supabase={rpc:async(name,args)=>{assert.ok(['custodial_begin_application_mutation_lease','custodial_heartbeat_application_mutation_lease','custodial_release_application_mutation_lease'].includes(name));
  const keys=Object.keys(args);const c=await admin.connect();try{await c.query('begin');await c.query('set local role service_role');const r=await c.query(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) as result`,keys.map(k=>args[k]));await c.query('commit');return {data:r.rows[0].result};}catch(e){await c.query('rollback');console.error('LOCAL_LEASE_RPC_FAILED',name,e.code,e.message);return {error:e};}finally{c.release();}}};
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database:authorityDb,controlPlane:cp,datedTransitionController:null,supabase,trustedDeviceStore:trusted});
 server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const token=access=>createOpsManagerSession({credentialId:credential,deviceId:device,manager:{manager_id:currentManager,display_name:currentManager===manager?'Synthetic selected-place manager':'Synthetic second manager',roles:['OPS_MANAGER'],active:true},authMode:'trusted_device',accessLevel:access,maximumAccessLevel:'full_access',env}).token;
 const http=async(route,body,{auth=true,access='full_access'}={})=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer '+token(access),'X-Device-Id':device}:{})},...(body?{body:JSON.stringify(body)}:{})});const result={status:r.status,body:await r.json()};if(result.status>=500)console.error('LOCAL_HTTP_FAILED',route,result);return result;};
 const rev=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
 const body=()=>({source_publication_id:authority.publicationId,effective_start:next,expected_revision:rev(),selection:selected,reason:'Explicit selected names, no other plan change'});
 check('HTTP no identity denied',(await http('/static-weekly/places/preview',body(),{auth:false})).status,401);
 check('HTTP readonly denied',(await http('/static-weekly/places/preview',body(),{access:'read_only'})).status,403);
 check('HTTP client source/actor denied',(await http('/static-weekly/places/preview',{...body(),candidate_source:source,manager_id:otherManager})).status,409);
 const p=await http('/static-weekly/places/preview',body());if(p.status!==200)console.error('PREVIEW_FAILED',p);check('actual HTTP compiler preview',p.status,200);
 console.log('LOCAL_PRIVATE_CANDIDATE_LABELS',sql(`select jsonb_build_object('selection',(select jsonb_agg(jsonb_build_object('kind',x->>'legacy_kind','id',x->>'legacy_id','name',x#>>'{effective_snapshot,display_name}')) from jsonb_array_elements(p.selection) x),'work',(select jsonb_agg(jsonb_build_object('id',x->>'locationId','code',x->>'locationCodeSnapshot','name',x->>'locationNameSnapshot')) from jsonb_array_elements(p.candidate_source#>'{version,assignments}') x where x->>'locationId'=${q(physical)})) from public.custodial_place_operational_previews p where preview_id=${q(p.body.data.preview_id)}`));
 check('preview is not accepted',p.body.data.accepted,false);check('preview eligibility unchanged',p.body.data.eligibility_changed,false);
 const command={operation_id:randomUUID(),preview_id:p.body.data.preview_id};
 reject('private source cannot escape incomplete transaction',`begin;set local role static_weekly_control_plane;select public.custodial_place_operational_begin(${q(manager)},${q(randomUUID())},${q(command.preview_id)});commit;`,/23514.*cannot commit without complete/s);
 const raced=await Promise.all([http('/static-weekly/places/confirm',command),http('/static-weekly/places/confirm',command)]);
 for(const reply of raced){if(reply.status!==200)console.error('CONFIRM_FAILED',reply);check('actual HTTP atomic publication',reply.status,200);}
 const receipt=raced.find(x=>x.body.data.replayed!==true);assert.ok(receipt);check('concurrent exact operation one replay',raced.filter(x=>x.body.data.replayed===true).length,1);
 check('one durable receipt after concurrent confirmation',sql(`select count(*) from public.custodial_place_operational_receipts where operation_id=${q(command.operation_id)}`),'1');
 check('PENDING never phone delivered',receipt.body.data.phone_delivery_state,'PENDING');check('exact operation receipt',receipt.body.data.operation_id,command.operation_id);
 check('actual authenticated status',(await http('/static-weekly/places/operations/'+command.operation_id)).body.data,receipt.body.data);
 check('lost response exact replay',(await http('/static-weekly/places/confirm',command)).body.data.replayed,true);
 check('old issued snapshot bytes survive metadata and publication',sql(`select to_jsonb(s)::text from public.custodial_offline_scan_authority_snapshots s where snapshot_id=${q(snapshot.snapshot_id)}`),originalSnapshot);
 // Real SQL activation/completion, synthetic native-route evidence ONLY.
 // It proves queued pre-change work is not rewritten/rejected by Place
 // metadata/publication. It is NOT an actual future-clock or physical NFC tap.
 const startStatement=`set role service_role;select public.tool_start_offline_occurrence(${q(handsetCode)},${q(places.W.code)},${q(savedStart.session)},${q(savedStart.started)},${q(snapshot.snapshot_id)},${q(snapshot.employee_id)},${snapshot.assignment_epoch},${q(phoneCredential)},${q(phoneCredential)},${q(savedStart.scan)},'custodial-native-start.v1',repeat('a',64),${q(routeSecret)},${q(executionSecret)})`;
 const context=JSON.parse(sql(startStatement));check('queued original snapshot Start synchronizes after adoption',context.snapshot_id,snapshot.snapshot_id);
 check('original queued Start exact replay',JSON.parse(sql(startStatement)).replayed,true);
 const finishAt=new Date(Date.parse(savedStart.started)+1000).toISOString(),finishId=randomUUID(),completionId=randomUUID();
 const finishEvidence=[{client_event_id:finishId,event_type:'scan_finish',result:'ok',notes:'SYNTHETIC PLACE COMPATIBILITY FIXTURE',scanned_at:finishAt,payload_json:{entry_source:'native-nfc'}}];
 const complete=code=>`set role service_role;select public.tool_commit_cleaning_workflow_authoritative(${q(savedStart.session)},${q(completionId)},${q(handsetCode)},${q(code)},${q(savedStart.started)},${q(finishAt)},${j({work_result:'full',services_performed:['Full cleaning services']})},${j(finishEvidence)},'Synthetic Place saved original Finish',${q(context.context_id)},${q(context.submission_proof)},${q(phoneCredential)},${q(finishId)},'custodial-native-completion.v2',repeat('b',64),${q(routeSecret)},${q(executionSecret)})`;
 check('original same-route saved Finish commits',JSON.parse(sql(complete(places.W.code))).status,'closed');
 const originalFinishReplay=JSON.parse(sql(complete(places.W.code)));
 check('original same-route Finish exact replay',originalFinishReplay.replayed,true);
 const mismatchedReplay=JSON.parse(sql(complete(places.E.code)));
 // The completed original operation wins before mutable locator revalidation.
 // This is receipt recovery, not physical-tag admission or a new completion.
 check('changed browser locator recovers only exact original completion',mismatchedReplay,originalFinishReplay);
 const at=next+'T10:00:00Z';check('future name not active now',sql(`set role service_role;select public.place_operational_location_name(${q(physical)},clock_timestamp())`),places.W.name);
 check('accepted physical name at explicit instant after Chicago 04 boundary',sql(`set role service_role;select public.place_operational_location_name(${q(physical)},${q(at)})`),'Accepted renamed physical');
 check('original physical bytes unchanged',sql("select md5(jsonb_agg(to_jsonb(l) order by id)::text) from public.locations l"),rawBefore);
 check('protected Start/Finish definitions unchanged',sql("select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by oid::regprocedure::text)) from pg_proc where pronamespace='public'::regnamespace and proname in('tool_start_offline_occurrence','tool_finish_session','tool_complete_session','tool_commit_cleaning_workflow_authoritative','custodial_start_offline_occurrence')"),before);
 const pub=receipt.body.data.publication_id;
 const adopted=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v3_read_publication_source(${q(pub)},${q(next)})`)).compiler_input;
 check('Scheduler primary human name',adopted.version.assignments.find(x=>x.locationId===physical).locationNameSnapshot,'Accepted renamed group');
 check('Scheduler included physical human name',adopted.version.assignments.find(x=>x.locationId===physical).includedLocations[0].locationNameSnapshot,'Accepted renamed physical');
 check('accepted human alias remains separate from tag routes',receipt.body.data.selection.find(x=>x.legacy_id===physical).effective_snapshot.aliases.includes('physical_location human alias'),true);
 check('actual application reader scalar exposes only accepted display',sql(`set role custodial_application_reader;select public.place_operational_location_name(${q(physical)},${q(at)})`),'Accepted renamed physical');
 reject('new generic stale-label source is denied',`select public.place_operational_assert_accepted_names(${q(authority.sourceId)},${q(next)})`,/55000.*silently replace.*physical display/s);
 const publishKey=`place:${command.operation_id}:publish`;
 const originalPublish=JSON.parse(sql(`select jsonb_build_object('request',request_canonical_json,'response',response_json) from public.weekly_schedule_command_receipts where actor_manager_id=${q(manager)} and idempotency_key=${q(publishKey)}`));
 const r=originalPublish.request;
 const publishReplay=revision=>`set role static_weekly_control_plane;select public.static_weekly_v3_publish_draft(${q(r.draft_version_id)},${r.expected_draft_revision},${revision},${q(manager)},${q(publishKey)},${q(r.publication_kind)},null)`;
 check('generic publication child recovers exact original receipt',JSON.parse(sql(publishReplay(r.expected_revision))),originalPublish.response);
 reject('generic receipt skip cannot forge changed semantic input',publishReplay(r.expected_revision+1),/23505.*different semantic inputs/s);
 currentManager=otherManager;
 check('foreign manager cannot recover original command',(await http('/static-weekly/places/operations/'+command.operation_id)).status,409);
 check('foreign manager cannot replay original command',(await http('/static-weekly/places/confirm',command)).status,409);currentManager=manager;
 const sqlPreview=(selection=selected)=>`set role static_weekly_control_plane;select public.custodial_place_operational_preview(${q(manager)},${q(pub)},${q(next)},${rev()},${j(selection)},'Synthetic explicit source CAS preview');`;
 const stale=JSON.parse(sql(sqlPreview()));
 const metadata=(kind,id,action,payload={})=>{const x=JSON.parse(sql(`set role service_role;select public.custodial_place_source_preview(${q(manager)},${q(kind)},${q(id)},${q(action)},${j(payload)},null,'Synthetic pending metadata change');`));return JSON.parse(sql(`set role service_role;select public.custodial_place_source_confirm(${q(randomUUID())},${q(manager)},${q(x.preview_id)});`));};
 metadata('physical_location',physical,'rename',{display_name:'New pending name not accepted'});
 check('actual HTTP source drift CAS',(await http('/static-weekly/places/confirm',{operation_id:randomUUID(),preview_id:stale.preview_id})).status,409);
 check('historical original receipt survives changed desired head',(await http('/static-weekly/places/confirm',command)).body.data.replayed,true);
 metadata('physical_location',physical,'reclassify',{cleaning_mode:'REMINDER_ONLY'});
 reject('physical mode change is not hidden name adoption',sqlPreview([{legacy_kind:'physical_location',legacy_id:physical,revision:3}]),/55000.*replacement-duty/s);
 metadata('physical_location',physical,'deactivate');
 reject('inactive identity is not hidden name adoption',sqlPreview([{legacy_kind:'physical_location',legacy_id:physical,revision:4}]),/40001.*inactive.*reconciliation/s);
 metadata('location_group',group,'memberships',{member_location_ids:[places.E.id]});
 reject('membership change is not hidden name adoption',sqlPreview([{legacy_kind:'location_group',legacy_id:group,revision:2}]),/55000.*Membership.*replacement-duty/s);
 check('pending destructive metadata does not replace accepted display',sql(`set role service_role;select public.place_operational_location_name(${q(physical)},${q(at)})`),'Accepted renamed physical');
 sql(`update public.ops_manager_managers set active=false where manager_id=${q(manager)}`);
 const revoked=await http('/static-weekly/places/operations/'+command.operation_id);assert.ok([401,403].includes(revoked.status));checks++;
 sql(`update public.ops_manager_managers set active=true where manager_id=${q(manager)}`);
 const statusSignature='public.custodial_place_operational_status(uuid,uuid)';
 // Match the exact identity spelling captured by PostgreSQL's regprocedure
 // renderer under the supported database/search path, not a guessed prefix.
 const inventoryIdentity=sql(`select ${q(statusSignature)}::regprocedure::text`);
 const restore=sql(`select definition_sql from public.custodial_release_authority_restore_inventory where object_identity=${q(inventoryIdentity)} and object_kind='function'`);
 const restoreGrants=sql(`select definition_sql from public.custodial_release_authority_restore_inventory where object_identity=${q(inventoryIdentity)} and object_kind='grant'`);
 assert.ok(restore&&restoreGrants);sql(`drop function ${statusSignature}`);sql(restore);sql(restoreGrants);
 check('owning function/grant recovery returns exact original receipt',(await http('/static-weekly/places/operations/'+command.operation_id)).body.data,receipt.body.data);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) {
  for(const table of ['custodial_place_operational_previews','custodial_place_operational_commands','custodial_place_operational_receipts'])reject('private ledger '+role+' '+table,`set role ${role};select * from public.${table}`,/42501.*permission denied/s);
  if(role!=='static_weekly_control_plane')reject('private admission '+role,`set role ${role};select public.custodial_place_operational_begin(${q(manager)},${q(randomUUID())},${q(command.preview_id)})`,/42501.*permission denied/s);
 }
 for(const [file,digest] of manifest)check('unchanged tested source '+file,hash(readFileSync('supabase/migrations/'+file)),digest);
 console.log(JSON.stringify({status:'PLACE_NAMES_DATABASE_PASS',checks,migrations:files.length,migration_sha256:manifest.get('20261003030000_place_operational_name_adoption.sql'),actualAuthenticatedHttp:true,automaticGrantsAbsent:true,physicalProof:false,productionWritten:false}));
}finally{
 if(server)await new Promise(r=>server.close(r));if(cp)await cp.close();else if(authorityDb)await authorityDb.end();if(admin)await admin.end();
 await shutdownStaticWeeklyCompiler();
 if(owned){docker(['rm','-f',container]);assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}
}
