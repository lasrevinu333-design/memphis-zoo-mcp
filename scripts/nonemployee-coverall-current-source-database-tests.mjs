// Disposable historical fixture only: never converts production people or
// assumes that the live source contains this explicit legacy pool.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {Pool} from 'pg';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {nonemployeeCoverAllLunchSource} from './fixtures/nonemployee-coverall-source.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
const container=`mz_schema_rebuild_capacity_current_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
let owned=false,checks=0,pool,server,protectedDefinitions,employeeConstraints,completed=false;
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;'+text}).trim();
const q=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,text,pattern)=>{let error;try{sql(text);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const protectedSql="select jsonb_object_agg(oid::regprocedure::text,public.static_weekly_digest_text(pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and (proname like '%offline%' or proname in('get_location_scan_state','get_location_scan_state_v2'))";
const constraintsSql="select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname) from pg_constraint where contype='c' and conrelid in('public.weekly_schedule_slot_assignments'::regclass,'public.weekly_schedule_occurrences'::regclass,'public.weekly_schedule_projection_assignments'::regclass)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
const predecessorHostileTests=()=>{
 const preflight=readFileSync('supabase/migrations/20261003190000_static_weekly_capacity_current_source_bridge.sql','utf8').match(/do \$predecessors\$[\s\S]*?end \$predecessors\$;/)[0];
 const inventory='public.custodial_release_authority_restore_inventory',immutable='trg_custodial_release_authority_restore_inventory_immutable';
 reject('unknown internally valid owning predecessor drift denied',`begin;alter table ${inventory} disable trigger ${immutable};update ${inventory} set definition_sql=definition_sql||E'\\n-- unexplained',definition_sha256=public.static_weekly_digest_text(definition_sql||E'\\n-- unexplained') where object_kind='function' and object_identity like '%static_weekly_v3_create_draft(%';${preflight}`,/stored predecessor drift requires reconciliation/s);
 reject('invalid stored predecessor integrity denied',`begin;alter table ${inventory} disable trigger ${immutable};update ${inventory} set definition_sql=definition_sql||E'\\n-- corrupt' where object_kind='function' and object_identity like '%static_weekly_v3_create_draft(%';${preflight}`,/stored predecessor integrity invalid/s);
 reject('same name different function identity denied',`begin;alter table ${inventory} disable trigger ${immutable};update ${inventory} set object_identity='public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text)' where object_kind='function' and object_identity like '%static_weekly_v3_create_draft(%' and object_identity like 'public.%';${preflight}`,/different identity/s);
};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{if(owned)docker(['rm','-f',container]);}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);docker(['run','--rm','-d','--name',container,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','listen_addresses=*','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','cron.database_name=postgres']);owned=true;console.log('OWNED_CONTAINER',container);
 let ready=0;for(let i=0;i<100&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,5);removeDefaults();
 const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
 const executedManifest=[];
 for(const file of files){check('absent defaults before '+file,sql(defaults),'0');
  if(file==='20261003190000_static_weekly_capacity_current_source_bridge.sql'){
   protectedDefinitions=sql(protectedSql);employeeConstraints=sql(constraintsSql);
   predecessorHostileTests();
   const predecessors=JSON.parse(sql("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'oid',p.oid,'live_definition',pg_get_functiondef(p.oid),'live_definition_sha256',public.static_weekly_digest_text(pg_get_functiondef(p.oid)),'aliases',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('resolved_oid',to_regprocedure(i.object_identity)::oid,'stored_integrity',i.definition_sha256=public.static_weekly_digest_text(i.definition_sql),'expected_live_grant',case when i.object_kind='grant' then public.custodial_release_authority_current_grant_definition(i.object_identity) else null end) order by object_kind,restore_order) from public.custodial_release_authority_restore_inventory i where object_kind in('function','grant') and object_identity like '%(%' and position(p.proname||'(' in object_identity)>0),'[]'::jsonb)) order by p.proname) from pg_proc p where p.oid in('public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure,'public.static_weekly_v3_read_manager_snapshot_base(date)'::regprocedure)"));
   mkdirSync('output/authority/capacity-current-source',{recursive:true});
   writeFileSync('output/authority/capacity-current-source/owning-hook-predecessors.json',JSON.stringify({schema:'custodial.capacity-source-predecessors.v1',migration:file,predecessors},null,2)+'\n');
   console.log('OWNING_HOOK_PREDECESSOR_INVENTORY',sql("select coalesce(jsonb_agg(jsonb_build_object('order',i.restore_order,'kind',i.object_kind,'identity',i.object_identity,'resolved_oid',to_regprocedure(i.object_identity)::oid,'stored_hash',i.definition_sha256,'stored_integrity',i.definition_sha256=public.static_weekly_digest_text(i.definition_sql),'matches_live_predecessor',i.definition_sql=case when object_kind='function' then pg_get_functiondef(to_regprocedure(i.object_identity)) else public.custodial_release_authority_current_grant_definition(i.object_identity) end) order by i.object_kind,i.object_identity),'[]'::jsonb) from public.custodial_release_authority_restore_inventory i where object_kind in('function','grant') and object_identity like '%(%' and (object_identity like '%static_weekly_v3_create_draft(%' or object_identity like '%static_weekly_v3_publish_draft(%' or object_identity like '%static_weekly_v3_read_manager_snapshot_base(%')"));
  }
  const bytes=readFileSync('supabase/migrations/'+file,'utf8');executedManifest.push({ordinal:executedManifest.length+1,file,sha256:createHash('sha256').update(bytes).digest('hex')});
  try{sql(bytes);}catch(e){console.error('FAILED_MIGRATION',file,String(e.stderr));throw e;}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes,/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  check('absent defaults after '+file,sql(defaults),'0');await new Promise(r=>setImmediate(r));
 }
 console.log('EXACT_REPLAY_COMPLETE',files.length);
 const manifestSha=createHash('sha256').update(executedManifest.map(x=>x.file+' '+x.sha256).join('\n')+'\n').digest('hex');
 writeFileSync('output/authority/capacity-current-source/ordered-executed-manifest.json',JSON.stringify({schema:'custodial.executed-migration-manifest.v1',source_sql_files:files.length,executed_sql_files:executedManifest.length,skipped:[],manifest_sha256:manifestSha,migrations:executedManifest},null,2)+'\n');
 console.log('EXECUTED_MANIFEST_SHA256',manifestSha);
 check('protected core/offline/scan function bytes unchanged',sql(protectedSql),protectedDefinitions);
 check('all inherited employee/owner CHECK bytes unchanged',sql(constraintsSql),employeeConstraints);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator','static_weekly_control_plane']){
  reject(role+' private preview rows denied',`set role ${role};select * from public.static_weekly_capacity_source_previews`,/42501.*permission denied/s);
  reject(role+' private candidate helper denied',`set role ${role};select public.static_weekly_capacity_source_candidate('{}','[]',current_date,null,null)`,/42501.*permission denied/s);
  reject(role+' private order-equivalence helper denied',`set role ${role};select public.static_weekly_capacity_source_order_equivalent('{}','{}')`,/42501.*permission denied/s);
  if(role!=='static_weekly_control_plane')check(role+' no new function execution grant',sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_capacity_source_%' and has_function_privilege(${q(role)},oid,'EXECUTE')`),'0');
 }
 check('private ledger forced RLS on all three tables',sql("select count(*) from pg_class where relname in('static_weekly_capacity_source_previews','static_weekly_capacity_source_commands','static_weekly_capacity_source_receipts') and relrowsecurity and relforcerowsecurity"),'3');
 check('no policy exposes the private ledger',sql("select count(*) from pg_policy where polrelid in('public.static_weekly_capacity_source_previews'::regclass,'public.static_weekly_capacity_source_commands'::regclass,'public.static_weekly_capacity_source_receipts'::regclass)"),'0');
 check('one current owning recovery function per exact hook OID',sql("select count(*) from (select to_regprocedure(object_identity),count(*) n from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity like '%(%' and (object_identity like '%static_weekly_v3_create_draft(%' or object_identity like '%static_weekly_v3_publish_draft(%' or object_identity like '%static_weekly_v3_read_manager_snapshot_base(%') group by to_regprocedure(object_identity) having count(*)<>1) x"),'0');
 check('new private and exact-hook recovery functions match actual definitions',sql("select count(*) from public.custodial_release_authority_restore_inventory i where object_kind='function' and object_identity like '%(%' and (object_identity like '%static_weekly_capacity_source_%' or object_identity like '%static_weekly_v3_create_draft(%' or object_identity like '%static_weekly_v3_publish_draft(%' or object_identity like '%static_weekly_v3_read_manager_snapshot_base(%') and (definition_sha256<>public.static_weekly_digest_text(definition_sql) or definition_sql is distinct from pg_get_functiondef(to_regprocedure(object_identity)))"),'0');
 check('owning recovery ACL bytes use same proved normalized identity',sql("select count(*) from public.custodial_release_authority_restore_inventory i where object_kind='grant' and object_identity like '%(%' and (object_identity like '%static_weekly_capacity_source_%' or object_identity like '%static_weekly_v3_create_draft(%' or object_identity like '%static_weekly_v3_publish_draft(%' or object_identity like '%static_weekly_v3_read_manager_snapshot_base(%') and (definition_sha256<>public.static_weekly_digest_text(definition_sql) or definition_sql is distinct from public.custodial_release_authority_current_grant_definition(object_identity))"),'0');
 const multiset={slots:[{id:'tie',full:{a:1}},{id:'tie',full:{a:2}},{id:'other',full:{a:3}}],
  version:{slotAvailability:[{slotId:'tie',dayOfWeek:1,status:'a'},{slotId:'tie',dayOfWeek:1,status:'b'},{slotId:'other',dayOfWeek:2,status:'c'}],assignments:[{work:'first'},{work:'second'}]},exceptions:[1,2],extra:{protected:true}};
 const permutation=structuredClone(multiset);permutation.slots.reverse();permutation.version.slotAvailability.reverse();
 check('exact full-element multiset permits only both collection permutations with sort ties',sql(`select public.static_weekly_capacity_source_order_equivalent(${j(multiset)},${j(permutation)})`),'t');
 for(const [name,mutate] of [
  ['slot duplicate plus missing substitution',x=>{x.slots[1]=structuredClone(x.slots[0]);}],
  ['availability duplicate plus missing substitution',x=>{x.version.slotAvailability[1]=structuredClone(x.version.slotAvailability[0]);}],
  ['slot dropped',x=>x.slots.pop()],['slot extra duplicate',x=>x.slots.push(structuredClone(x.slots[0]))],
  ['slot unknown element field',x=>{x.slots[0].unknown=true;}],['availability extra field',x=>{x.version.slotAvailability[0].extra=true;}],
  ['assignment ordering',x=>x.version.assignments.reverse()],['other array ordering',x=>x.exceptions.reverse()],
  ['other object difference',x=>{x.extra.protected=false;}],['top-level extra field',x=>{x.injected=true;}],
 ]){const hostile=structuredClone(multiset);mutate(hostile);check('order equivalence rejects '+name,sql(`select public.static_weekly_capacity_source_order_equivalent(${j(multiset)},${j(hostile)})`),'f');}
 const restored=JSON.parse(sql("select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and object_identity like '%static_weekly_capacity_source_%'"));
 sql('grant execute on function public.static_weekly_capacity_source_candidate(jsonb,jsonb,date,uuid,uuid) to anon');
 sql(restored.join(';\n'));reject('actual private definition/ACL restoration re-denies helper',"set role anon;select public.static_weekly_capacity_source_candidate('{}','[]',current_date,null,null)",/42501.*permission denied/s);
 const manager=randomUUID(),otherManager=randomUUID();
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles) values(${q(manager)},'Synthetic source manager',array['OPS_MANAGER','CUSTODIAL_MANAGER']),(${q(otherManager)},'Synthetic second manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'])`);
 const week=sql("select date_trunc('week',clock_timestamp() at time zone 'America/Chicago')::date::text");
 const future=sql("select (date_trunc('week',clock_timestamp() at time zone 'America/Chicago')::date+7)::text");
 const {source,employees,capacities,areas}=nonemployeeCoverAllLunchSource(week);
 const legacyPeople=capacities.map((c,i)=>({id:randomUUID(),name:`Historical synthetic capacity incumbent ${i+1}`}));
 // Deliberately seed the inherited old model before conversion. No runtime
 // admission creates a person or silently reclassifies these historical rows.
 source.slots.filter(s=>s.contractorCapacity).forEach((s,i)=>{delete s.kind;delete s.capacityId;
  s.incumbencies=[{personId:legacyPeople[i].id,displayName:legacyPeople[i].name,effectiveStart:'2020-01-01',effectiveEnd:null}];});
 for(const [i,p] of [...employees,...legacyPeople].entries())sql(`insert into public.employees(id,employee_code,display_name,role) values(${q(p.id)},'CURRENT_CAPACITY_FIXTURE_${i}',${q(p.name)},'staff')`);
 for(const a of areas)sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,nfc_url,scan_router_url) values(${q(a.physical)},${q(a.code)},${q(a.name)},'restroom','restroom','synthetic-original-tag','synthetic-original-router');insert into public.location_groups(id,group_code,group_name) values(${q(a.group)},${q(a.code)},${q(a.name)});insert into public.location_group_memberships(location_group_id,location_id) values(${q(a.group)},${q(a.physical)});`);
 const authority=await seedCompiledEventAuthority({sql,container,database:'postgres',managerId:manager,dates:[week],source,label:'current-legacy-capacity'});
 const before=JSON.parse(sql("select jsonb_build_object('people',(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e),'incumbencies',(select md5(jsonb_agg(to_jsonb(i) order by incumbency_id)::text) from public.weekly_roster_slot_incumbencies i),'old_slots',(select md5(jsonb_agg(to_jsonb(s) order by slot_id)::text) from public.weekly_roster_slots s),'old_publication',(select md5(jsonb_agg(to_jsonb(p) order by publication_id)::text) from public.weekly_schedule_publications p))"));
 const port=Number(docker(['port',container,'5432/tcp']).trim().split(':').at(-1));
 sql("create role capacity_current_runtime login password 'synthetic-disposable-capacity';grant static_weekly_control_plane to capacity_current_runtime");
 pool=new Pool({connectionString:`postgresql://capacity_current_runtime:synthetic-disposable-capacity@127.0.0.1:${port}/postgres`,ssl:false});
 let finalizePause=null;
 const cp=createStaticWeeklyControlPlane({database:{async connect(){const client=await pool.connect();return {
  async query(...args){const text=typeof args[0]==='string'?args[0]:args[0]?.text;
   if(finalizePause&&!finalizePause.used&&text?.includes('static_weekly_capacity_source_finalize')){
    finalizePause.used=true;finalizePause.ready();await finalizePause.released;
   }return client.query(...args);},release(){client.release();},
 };}}});
 const env={NODE_ENV:'test',SUPABASE_URL:'https://capacity-source.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-disposable-fixture',OPS_MANAGER_SESSION_SECRET:'synthetic-source-session-secret-0123456789012345'};
 const managerRow={manager_id:manager,display_name:'Synthetic source manager',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true};
 const credentialId='synthetic-source-credential',deviceId='synthetic-source-device';let revoked=false;
 const session=createOpsManagerSession({credentialId,deviceId,manager:managerRow,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database:pool,controlPlane:cp,datedTransitionController:null,
  supabase:{async rpc(){return {data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};}},
  trustedDeviceStore:{async find(id){if(revoked||id!==credentialId)return null;
   const m=JSON.parse(sql(`select jsonb_build_object('manager_id',manager_id,'display_name',display_name,'roles',roles,'active',active) from public.ops_manager_managers where manager_id=${q(manager)}`));
   return {credential_id:credentialId,device_id:deviceId,max_access_level:'full_access',manager_id:manager,manager:m,
    created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};}}});
 server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,body,token=session.token)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
 const revision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
 const args={source_publication_id:authority.publicationId,effective_start:future,expected_revision:revision()};
 check('anonymous current-source basis denied',(await request('/static-weekly/coverall/source-basis',args,null)).status,401);
 check('client forged source rejected',(await request('/static-weekly/coverall/source-basis',{...args,compiler_input:source})).status,409);
 const basis=await request('/static-weekly/coverall/source-basis',args);check('authenticated HTTP actual DB source basis',basis.status,200);
 check('explicit actual legacy pool mapped only after selection',basis.body.data.state,'MAPPING_REQUIRED');
 check('exact eight legacy IDs',basis.body.data.legacy_slots.map(s=>s.legacy_slot_id).sort(),capacities.map(c=>c.slot).sort());
 const selection=capacities.map((c,i)=>({legacy_slot_id:c.slot,new_capacity_id:randomUUID(),capacity_code:`CoverAll0${i+1}`}));
 const preview=await request('/static-weekly/coverall/source-preview',{...args,selection,reason:'Explicit synthetic existing source replacement, preserve all history'});
 check('authenticated source preview compiled',preview.status,200);check('preview is not accepted',preview.body.data.published,false);
 const pid=preview.body.data.preview_id,operation=randomUUID();
 const stalePreview=await request('/static-weekly/coverall/source-preview',{...args,selection:selection.map(s=>({...s,new_capacity_id:randomUUID()})),reason:'Competing exact source preview'});
 check('independent competing source preview compiled',stalePreview.status,200);
 reject('begin cannot commit a partial registration/publication',`set role static_weekly_control_plane;select public.static_weekly_capacity_source_begin(${q(manager)},${q(randomUUID())},${q(pid)})`,/23514.*cannot commit without complete/s);
 check('partial begin rollback keeps zero registrations',sql('select count(*) from public.static_weekly_contractor_capacity_registrations'),'0');
 check('partial begin rollback keeps original seventeen slots',sql('select count(*) from public.weekly_roster_slots'),'17');
 check('partial begin rollback leaves no admission command',sql('select count(*) from public.static_weekly_capacity_source_commands'),'0');
 let signalReady,releaseFinalize;
 const paused=new Promise(r=>{signalReady=r;}),released=new Promise(r=>{releaseFinalize=r;});
 finalizePause={ready:signalReady,released,used:false};
 const autoRelease=setTimeout(releaseFinalize,10000);
 const confirmations=[request('/static-weekly/coverall/source-confirm',{operation_id:operation,preview_id:pid}),request('/static-weekly/coverall/source-confirm',{operation_id:operation,preview_id:pid})];
 await Promise.race([paused,new Promise((_,reject)=>setTimeout(()=>reject(new Error('confirmation did not reach receipt seam')),15000))]);
 let statusResolved=false;
 const inFlightStatus=request(`/static-weekly/coverall/source-operations/${operation}`).then(r=>{statusResolved=true;return r;});
 try{await new Promise(r=>setTimeout(r,50));check('operation reconciliation waits for in-flight admission lock',statusResolved,false);}
 finally{releaseFinalize();clearTimeout(autoRelease);}
 const concurrent=await Promise.all(confirmations);
 const receipt=concurrent.find(r=>r.status===200&&!r.body.data?.replayed)||concurrent[0];
 if(receipt.status!==200)console.error('SOURCE_CONFIRM_FAILED',JSON.stringify(receipt));
 check('authenticated existing-authority admission accepted',receipt.status,200);check('complete receipt accepted',receipt.body.data.state,'ACCEPTED');
 check('concurrent identical confirms both recover accepted response',concurrent.map(r=>r.status),[200,200]);
 check('concurrent confirmation creates exactly one command',sql('select count(*) from public.static_weekly_capacity_source_commands'),'1');
 check('blocked status observes committed exact receipt, never false absence',(await inFlightStatus).body.data,receipt.body.data);
 check('competing stale source preview fails CAS',(await request('/static-weekly/coverall/source-confirm',{operation_id:randomUUID(),preview_id:stalePreview.body.data.preview_id})).status,409);
 check('phone readback remains pending',receipt.body.data.affected_phones_updated,false);
 check('historical employees unchanged',sql('select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e'),before.people);
 check('historical incumbencies unchanged',sql('select md5(jsonb_agg(to_jsonb(i) order by incumbency_id)::text) from public.weekly_roster_slot_incumbencies i'),before.incumbencies);
 check('all old slots unchanged',sql(`select md5(jsonb_agg(to_jsonb(s) order by slot_id)::text) from public.weekly_roster_slots s where slot_id not in (${selection.map(s=>q(s.new_capacity_id)).join(',')})`),before.old_slots);
 check('original publication unchanged',sql(`select md5(jsonb_agg(to_jsonb(p) order by publication_id)::text) from public.weekly_schedule_publications p where publication_id=${q(authority.publicationId)}`),before.old_publication);
 check('append only eight capacity markers',sql('select count(*) from public.static_weekly_contractor_capacity_registrations'),'8');
 const currentSnapshot=await cp.getManagerSnapshot({manager:{manager_id:manager,manager_display_name:managerRow.display_name},weekStart:week});
 check('old week does not expose future setup slots',currentSnapshot.roster.length,17);
 const futureSnapshot=await cp.getManagerSnapshot({manager:{manager_id:manager,manager_display_name:managerRow.display_name},weekStart:future});
 check('accepted source roster has exactly nine ordinary positions',futureSnapshot.roster.filter(s=>!s.contractor_capacity).length,9);
 check('new typed roster has eight person-free capacities',futureSnapshot.roster.filter(s=>s.contractor_capacity&&s.incumbencies.length===0).length,8);
 check('new capacities never automatically working',sql(`select count(*) from public.weekly_schedule_projection_assignments where projection_id=${q(receipt.body.data.projection_id)} and owner_kind='CONTRACTOR_CAPACITY'`),'0');
 const readback=await request(`/static-weekly/coverall/source-operations/${operation}`);check('lost response exact original receipt recovery',readback.body.data,receipt.body.data);
 const replay=await request('/static-weekly/coverall/source-confirm',{operation_id:operation,preview_id:pid});check('exact confirm replay after revision change',replay.body.data,{...receipt.body.data,replayed:true});
 check('changed preview original key denied',(await request('/static-weekly/coverall/source-confirm',{operation_id:operation,preview_id:randomUUID()})).status,409);
 reject('second named manager cannot recover original receipt',`set role static_weekly_control_plane;select public.static_weekly_capacity_source_status(${q(otherManager)},${q(operation)})`,/42501.*Original named manager/s);
 const managerActor={manager_id:manager,manager_display_name:managerRow.display_name};
 const typedVersion=sql(`select version_id from public.weekly_schedule_publications where publication_id=${q(receipt.body.data.publication_id)}`);
 const manual=await cp.applyDayChanges({manager:managerActor,serviceDate:future,baseVersionId:typedVersion,publicationId:receipt.body.data.publication_id,
  expectedRevision:revision(),idempotencyKey:'current-source-explicit-dated-capacity',projectionWeekStart:future,operations:[
   {operation:'cover_all',slotId:selection[0].new_capacity_id,shift:{start:'07:00',end:'15:00'},reason:'Synthetic explicit manager add'},
   {operation:'exception',exceptionType:'lunch',startsAt:'12:00',endsAt:'13:00',payload:{slotId:selection[0].new_capacity_id},reason:'Explicit actual break'},
   {operation:'exception',exceptionType:'manager_correction',payload:{locks:[{workId:source.versions[0].assignments[0].workId,slotId:employees[0].slot},
    {workId:source.versions[0].assignments[1].workId,slotId:selection[0].new_capacity_id}]},reason:'Explicit synthetic area assignment'},
  ]});
 const lunch=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v8_read_lunch_document(${q(future)})`));
 check('converted-source manual lunch persists same accepted projection',lunch.projection_id,manual.data.projection_id);
 check('converted-source typed borrower has real employee helper',lunch.responsibilities.some(r=>r.normal_owner_capacity_id===selection[0].new_capacity_id&&r.coverer_person_id===employees[0].id&&r.segments.length>0),true);
 check('converted-source typed helper has null employee identity',lunch.responsibilities.some(r=>r.coverer_capacity_id===selection[0].new_capacity_id&&r.coverer_person_id===null&&r.normal_owner_person_id===employees[0].id&&r.segments.length>0),true);
 const print=await cp.getCoverAllPrintDocument({manager:managerActor,weekStart:future,serviceDate:future,expectedRevision:manual.revision,projectionId:manual.data.projection_id});
 check('converted source print document binds same projection',print.projectionId,manual.data.projection_id);
 check('converted source print names capacity not fictional person',print.contractors[0].name,'CoverAll01');
 for(const employee of employees){const day=JSON.parse(sql(`set role custodial_application_reader;select public.static_weekly_v5_read_employee_day(${q(future)},${q(employee.id)},${q(future+'T12:00:00-05:00')}::timestamptz)`));
  check('converted source employee readback same projection '+employee.name,day.projection_id,manual.data.projection_id);
  check('converted source employee readback persisted lunch '+employee.name,day.lunch_coverage_status,'PERSISTED');}
 check('manual current-source command still changes no person bytes',sql('select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e'),before.people);
 check('original source receipt remains exact after dated activation',(await request(`/static-weekly/coverall/source-operations/${operation}`)).body.data,receipt.body.data);
 revoked=true;check('revoked actual auth association denied',(await request(`/static-weekly/coverall/source-operations/${operation}`)).status,401);
 console.log(JSON.stringify({status:'PASS',checks,migrations:files.length,receipt:receipt.body.data,scope:'disposable actual authenticated HTTP/server-source preview/compiler/append-only current authority admission/publication/projection/lunch readback; historical fixture only; no current live data or physical delivery'}));
 completed=true;
}finally{
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(pool)await pool.end();await shutdownStaticWeeklyCompiler();
 if(owned){if(completed||process.env.CAPACITY_KEEP_FAILED_DB_FOR_DIAGNOSTIC!=='1')docker(['rm','-f',container]);
  else console.error('OWNED_RETAINED_DIAGNOSTIC_CONTAINER',container);}
}
