import {migrationReplayNames} from './migration-replay-order.mjs';
// Disposable actual SQL proof. No production connection, ports or credentials.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import express from 'express';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';
import {makeRestoreMutationGate} from '../src/restore-mutation-gate.js';
import {createPlacesAdminRouter} from '../src/places-api.js';
import {PLACE_LEGACY_PREVIEW_SQL} from '../src/place-reconciliation.js';
const root=path.resolve(import.meta.dirname,'..'),image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const container=`mz_schema_rebuild_place_bridge_${process.pid}`;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,...options});
const raw=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;\n'+text,stdio:['pipe','pipe','pipe']});
const sql=text=>raw(text).trim(),q=value=>`'${String(value).replaceAll("'","''")}'`,j=value=>`${q(JSON.stringify(value))}::jsonb`;
let checks=0,owned=false;
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const rejects=(statement,pattern,label)=>{let error;try{sql(statement);}catch(e){error=e;}assert.ok(error,label);assert.match(String(error.stderr),pattern,label);checks++;};
const parallel=statement=>new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres']);let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve(out.trim()));child.stdin.end('set client_min_messages=warning;\n'+statement);});
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
function removeDefaults(){for(const owner of ['postgres','supabase_admin'])for(const scope of ['','in schema public'])raw(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);}
const manager=randomUUID(),otherManager=randomUUID(),venue=randomUUID(),otherVenue=randomUUID(),place=randomUUID(),otherPlace=randomUUID();
const digest=table=>sql(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'[]')) from public.${table} x`);
const canonical=(id,revision,action,payload={},at=null)=>JSON.parse(sql(`set role service_role;select public.custodial_place_command(${q(randomUUID())},${q(manager)},${q(id)},${revision},${q(action)},${at?q(at)+'::timestamptz':'null'},${j(payload)},'Synthetic bridge target change');`).split('\n').at(-1));
const previewSql=(id=venue,action='map',target=place,{at=null,actor=manager,kind='event_venue'}={})=>`set role service_role;select public.custodial_place_bridge_preview(${q(actor)},${q(kind)},${q(id)},${q(action)},${target?q(target)+'::uuid':'null'},${at?q(at)+'::timestamptz':'null'},'Synthetic explicit manager mapping');`;
const preview=(...args)=>JSON.parse(sql(previewSql(...args)).split('\n').at(-1));
const confirmSql=(p,request=randomUUID(),actor=manager)=>`set role service_role;select public.custodial_place_bridge_confirm(${q(request)},${q(actor)},${q(p)});`;
const confirm=(...args)=>JSON.parse(sql(confirmSql(...args)).split('\n').at(-1));
const overlay=(at=null)=>JSON.parse(sql(`begin read only;set local role custodial_application_reader;select public.custodial_place_event_venue_overlay(${at?q(at)+'::timestamptz':'statement_timestamp()'});rollback;`).split('\n').at(-1));
try{
 docker(['image','inspect',image]);docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log('OWNED_PLACE_BRIDGE_CONTAINER',container);
 const info=JSON.parse(docker(['inspect',container]))[0];check(info.HostConfig.NetworkMode,'none','isolated network');check(Object.keys(info.HostConfig.PortBindings??{}).length,0,'no ports');
 let ready=0;for(let i=0;i<120&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}check(ready,5,'ready');removeDefaults();
 const migrations=migrationReplayNames(root),appliedHashes=new Map();
 for(const [i,file] of migrations.entries()){
  check(sql(defaults),'0',`default absence before ${file}`);const bytes=readFileSync(path.join(root,'supabase/migrations',file));appliedHashes.set(file,createHash('sha256').update(bytes).digest('hex'));raw(bytes);
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  check(sql(defaults),'0',`default absence after ${file}`);if((i+1)%25===0)console.log('APPLIED_PLACE_BRIDGE_MIGRATIONS',i+1);
 }
 console.log('EXACT_PLACE_BRIDGE_REPLAY_COMPLETE',migrations.length);
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic Bridge Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false),(${q(otherManager)},'Synthetic Second Bridge Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false);
 insert into public.event_venues(id,venue_code,display_name,aliases) values(${q(venue)},'BRIDGE_SYNTHETIC_A','Synthetic legacy A',array['Legacy explicit A']),(${q(otherVenue)},'BRIDGE_SYNTHETIC_B','Synthetic legacy B',array['Legacy explicit B']);`);
 canonical(place,0,'add',{canonical_code:'BRIDGE_CANONICAL_A',display_name:'Synthetic canonical A',aliases:['Canonical explicit A'],cleaning_mode:'NEVER_CLEAN',event_eligible:true});
 canonical(otherPlace,0,'add',{canonical_code:'BRIDGE_CANONICAL_B',display_name:'Synthetic canonical B',aliases:['Canonical explicit B'],cleaning_mode:'NEVER_CLEAN',event_eligible:true});
 const legacy=Object.fromEntries(['locations','location_groups','location_group_aliases','location_group_memberships','event_area_aliases','event_venues','events_app_events'].map(t=>[t,digest(t)]));
 check(overlay().venues.find(v=>v.venue_id===venue).mapping_status,'UNMAPPED','unmapped behavior preserved');
 const initial=preview(),request=randomUUID();check(initial.proposal.expected_bridge_revision,0,'new bridge CAS');check(initial.proposal.place_id,place,'explicit UUID only');check(initial.proposal.active,true,'active mapping');check(initial.actor_manager_id,manager,'server actor');
 check(Date.parse(initial.expires_at)-Date.parse(initial.created_at),600000,'server expiry10min');
 const receipt=confirm(initial.preview_id,request);check(receipt.data.revision,1,'map append');check(confirm(initial.preview_id,request).replayed,true,'stable request exact replay');
 for(const [table,hash] of Object.entries(legacy))check(digest(table),hash,`${table} bytes unchanged by initial bridge`);
 rejects(confirmSql(initial.preview_id,request,otherManager),/23505.*identity conflict/s,'foreign actor replay denied');rejects(confirmSql(randomUUID(),request),/23505.*identity conflict/s,'same request different preview denied');
 let current=overlay().venues.find(v=>v.venue_id===venue);check(current.mapping_status,'MAPPED','actual reader mapped overlay');check(current.venue_id,venue,'legacy UUID retained');check(current.canonical_place_id,place,'canonical UUID explicit separately');check(current.display_name,'Synthetic canonical A','canonical name overlay');check(current.raw_legacy.display_name,'Synthetic legacy A','raw legacy name unchanged');
 for(const key of ['schedule_eligible','staffing_eligible','nfc_eligible','overdue_eligible'])check(current[key],false,`mapped never clean ${key}`);
 canonical(place,1,'rename',{display_name:'Synthetic renamed A'});check(overlay().venues.find(v=>v.venue_id===venue).display_name,'Synthetic renamed A','actual authority rename read overlay');
 const staleTarget=preview();canonical(place,2,'aliases',{aliases:['Explicit new alias']});rejects(confirmSql(staleTarget.preview_id),/40001.*target changed/s,'canonical CAS rejects drift');
 const a=preview(),b=preview();const race=await Promise.allSettled([parallel(confirmSql(a.preview_id)),parallel(confirmSql(b.preview_id))]);check(race.filter(x=>x.status==='fulfilled').length,1,'concurrent bridge CAS one winner');check(race.filter(x=>x.status==='rejected').length,1,'concurrent stale CAS denied');
 // The source writer wins first while confirm holds Place singleton and waits
 // for its catalog SHARE lock. Confirm must read the new source after waiting.
 const waiting=preview();let writerLocked;const acquired=new Promise(resolve=>{writerLocked=resolve;});
 const writer=spawn('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres']);
 let writerOut='',writerErr='';writer.stdout.on('data',b=>{writerOut+=b;if(writerOut.includes('SOURCE_WRITER_LOCKED'))writerLocked();});writer.stderr.on('data',b=>writerErr+=b);
 const writerDone=new Promise((resolve,reject)=>{writer.on('error',reject);writer.on('close',code=>code?reject(new Error(writerErr)):resolve());});
 writer.stdin.end(`begin;lock table public.event_venues in row exclusive mode;select 'SOURCE_WRITER_LOCKED';select pg_sleep(1);update public.event_venues set aliases=array['Writer committed changed alias'] where id=${q(otherVenue)};commit;`);
 await acquired;let sourceRaceError;try{await parallel(confirmSql(waiting.preview_id));}catch(error){sourceRaceError=error;}await writerDone;
 assert.match(String(sourceRaceError),/source changed/);checks++;
 sql(`update public.event_venues set aliases=array['Legacy explicit B'] where id=${q(otherVenue)};`);
 // Revalidate the original explicit target against the changed source list.
 confirm(preview().preview_id);check(overlay().venues.find(v=>v.venue_id===venue).mapping_status,'MAPPED','explicit revalidation after catalog writer');
 canonical(place,3,'deactivate');check(overlay().venues.find(v=>v.venue_id===venue).mapping_status,'NEEDS_REVIEW','canonical deactivation blocks mapped consumer, not legacy fallback');
 rejects(previewSql(),/23514.*conflict/s,'inactive canonical cannot acquire active mapping');canonical(place,4,'reactivate');check(overlay().venues.find(v=>v.venue_id===venue).mapping_status,'MAPPED','canonical reactivation preserves explicit identity');
 const off=confirm(preview(venue,'deactivate',null).preview_id);check(off.data.active,false,'inactive version retained');check(overlay().venues.find(v=>v.venue_id===venue).mapping_status,'INACTIVE','no legacy fallback when bridge inactive');
 const reversed=confirm(preview(venue,'reverse',null).preview_id);check(reversed.data.active,true,'append-only reversal');
 const future=new Date(Date.now()+86400000).toISOString(),after=new Date(Date.now()+172800000).toISOString();
 const planned=confirm(preview(venue,'deactivate',null,{at:future}).preview_id);current=overlay().venues.find(v=>v.venue_id===venue);check(current.mapping_status,'MAPPED','future inactive not early');check(current.bridge_latest_revision,planned.data.revision,'latest planned head exposed');check(current.bridge_revision,planned.data.revision-1,'effective revision distinct');check(overlay(after).venues.find(v=>v.venue_id===venue).mapping_status,'INACTIVE','future effective inactive');
 rejects(previewSql(venue,'reactivate',null),/22023.*monotonically/s,'future bridge cannot backfill');
 const invalidTarget=randomUUID();canonical(invalidTarget,0,'add',{canonical_code:'BRIDGE_CONFLICT_TARGET',display_name:'Conflict Target',aliases:['Synthetic legacy B'],cleaning_mode:'NEVER_CLEAN',event_eligible:true});
 rejects(previewSql(venue,'map',invalidTarget,{at:future}),/23514.*conflict/s,'mapped aliases cannot steal active legacy venue name');
 rejects(previewSql(venue,'map',place,{kind:'physical_location'}),/55000.*Physical\/group/s,'physical namespace deliberately unsupported');rejects(previewSql(venue,'map',place,{kind:'location_group'}),/55000.*Physical\/group/s,'group namespace deliberately unsupported');
 const expired=preview(otherVenue,'map',otherPlace);sql(`alter table public.custodial_place_bridge_previews disable trigger place_bridge_immutable;update public.custodial_place_bridge_previews set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where preview_id=${q(expired.preview_id)};alter table public.custodial_place_bridge_previews enable trigger place_bridge_immutable;`);rejects(confirmSql(expired.preview_id),/40001.*expired/s,'expired uncommitted preview denied');
 const drift=preview(otherVenue,'map',otherPlace);sql(`update public.event_venues set aliases=array['Changed legacy alias'] where id=${q(otherVenue)};`);rejects(confirmSql(drift.preview_id),/40001.*source changed/s,'complete source alias drift denies confirm');current=overlay().venues.find(v=>v.venue_id===venue);check(current.mapping_status,'NEEDS_REVIEW','already mapped source drift is not old fallback');check(current.review_reason,'legacy_source_drift','drift explicit');
 sql(`update public.event_venues set aliases=array['Legacy explicit B'] where id=${q(otherVenue)};`);
 // Updated_at trigger itself changes source hash: intentional current mapping review.
 check(confirm(initial.preview_id,request).replayed,true,'committed receipt survives source drift/preview expiry');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  for(const table of ['custodial_place_bridge_previews','custodial_place_bridge_versions'])rejects(`set role ${role};select * from public.${table}`,/42501.*permission denied/s,`${role} private table denied`);
  rejects(`set role ${role};select public.place_bridge_source()`,/42501.*permission denied/s,`${role} internal source denied`);
  rejects(`set role ${role};select public.place_bridge_sha('{}'::jsonb)`,/42501.*permission denied/s,`${role} internal hash denied`);
  rejects(`set role ${role};select public.place_bridge_overlay(now(),null)`,/42501.*permission denied/s,`${role} internal overlay denied`);
  if(role!=='service_role'){
   rejects(previewSql().replace('set role service_role',`set role ${role}`),/42501.*permission denied/s,`${role} preview denied`);
   rejects(confirmSql(initial.preview_id,request).replace('set role service_role',`set role ${role}`),/42501.*permission denied/s,`${role} confirm denied`);
  }
  if(!['service_role','custodial_application_reader'].includes(role))rejects(`set role ${role};select public.custodial_place_event_venue_overlay(now())`,/42501.*permission denied/s,`${role} overlay denied`);
 }
 rejects('delete from public.custodial_place_bridge_versions',/append-only.*forbidden/s,'bridge history cannot delete');
 const history=digest('custodial_place_bridge_versions');sql('drop function public.custodial_place_event_venue_overlay(timestamptz)');raw(sql("select string_agg(definition_sql||';',E'\\n' order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and object_identity like '%custodial_place_event_venue_overlay%';"));
 check(overlay().venues.find(v=>v.venue_id===venue).venue_id,venue,'actual reader restored');check(digest('custodial_place_bridge_versions'),history,'recovery preserves exact bridge history');rejects('set role authenticated;select public.custodial_place_event_venue_overlay(now())',/42501.*permission denied/s,'recovered client denial');
 for(const [table,hash] of Object.entries(legacy)){if(table==='event_venues')continue;check(digest(table),hash,`${table} untouched`);} // Venue drift above was an explicit synthetic test mutation, not the bridge.
 check(sql("select bool_and(relrowsecurity and relforcerowsecurity)::text from pg_class where relname in('custodial_place_bridge_previews','custodial_place_bridge_versions')"),'true','FORCE RLS');
 // Actual existing signed HTTP guard -> JS lease -> real service-role SQL,
 // plus read-only source SELECT under the actual dedicated application reader.
 const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-bridge-http-test-secret'},credential=randomUUID(),device='BRIDGE_SYNTHETIC_HTTP';
 const named={manager_id:otherManager,display_name:'Synthetic Second Bridge Manager',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true,revoked_at:null};
 const trusted={credential_id:credential,device_id:device,device_label:device,token_hash:'synthetic-only',max_access_level:'full_access',manager_id:otherManager,manager:named,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
 const rpcCalls=[],allowed=new Set(['custodial_place_preview','custodial_place_bridge_preview','custodial_place_bridge_confirm','custodial_place_event_venue_overlay','custodial_begin_application_mutation_lease','custodial_heartbeat_application_mutation_lease','custodial_release_application_mutation_lease']);
 const client={rpc:async(name,args)=>{
  assert.ok(allowed.has(name));rpcCalls.push(name);
  const argumentsSql=Object.entries(args).map(([key,value])=>{assert.match(key,/^p_[a-z_]+$/);return `${key} => ${value===null?'null':typeof value==='number'?value:q(value)}`;}).join(',');
  try{return {data:JSON.parse(sql(`set role service_role;select to_jsonb(public.${name}(${argumentsSql}));`).split('\n').at(-1)||'null')};}
  catch(error){const message=String(error.stderr||error);return {error:{code:/ERROR:\s+([A-Z0-9]{5}):/.exec(message)?.[1],message}};}
 }};
 const app=express();app.use(express.json({limit:'64kb'}));app.use(makeRestoreMutationGate({supabase:client,required:true,serviceName:'synthetic-place-bridge-http'}));
 app.use('/admin-api/places',createPlacesAdminRouter({client,requireManagerWrite:makeOpsAccessMiddleware({env,requireWrite:true,trustedDeviceStore:{find:async id=>id===credential?trusted:null}}),
  runReadOnlySql:async query=>{check(query,PLACE_LEGACY_PREVIEW_SQL,'static legacy reader only');return JSON.parse(sql(`begin read only;set local role custodial_application_reader;select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (${query}) t;rollback;`).split('\n').at(-1));}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const token=accessLevel=>createOpsManagerSession({credentialId:credential,deviceId:device,manager:named,authMode:'trusted_device',accessLevel,maximumAccessLevel:'full_access',env}).token;
 async function http(route,{body,access='full_access',authenticated=true}={}){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/admin-api/places${route}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(authenticated?{authorization:`Bearer ${token(access)}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
 }
 try{
  check((await http('/bridge/overlay',{authenticated:false})).status,401,'real HTTP missing identity denied');check((await http('/bridge/overlay',{access:'read_only'})).status,403,'real HTTP readonly denied');
  const read=await http('/reconciliation');check(read.status,200,'actual authenticated static reader query');check(read.body.data.consumer_cutover,false,'reader is not cutover');
  const response=await http('/bridge/preview',{body:{legacy_kind:'event_venue',legacy_id:otherVenue,action:'map',target_place_id:otherPlace,reason:'Actual second manager HTTP confirmed UUID'}});
  check(response.status,200,'actual HTTP-to-SQL preview');check(response.body.data.actor_manager_id,otherManager,'actual named second manager');
  const command={request_id:randomUUID(),preview_id:response.body.data.preview_id},sent=await http('/bridge/confirm',{body:command});
  check(sent.status,200,'actual HTTP-to-SQL confirm');check(sent.body.request_id,command.request_id,'actual receipt operation');check(sent.body.data.legacy_id,otherVenue,'actual receipt legacy UUID');check(sent.body.data.actor_manager_id,otherManager,'actor is server authenticated');
  check((await http('/bridge/confirm',{body:command})).body.replayed,true,'actual HTTP original receipt recovery');
  check((await http('/bridge/preview',{body:{legacy_kind:'physical_location',legacy_id:venue,action:'map',target_place_id:place,reason:'Wrong namespace'}})).status,422,'actual HTTP physical mapping rejected');
  check((await http('/bridge/confirm',{body:{...command,manager_id:manager}})).status,422,'actual HTTP actor spoof rejected');
  check(rpcCalls.includes('custodial_begin_application_mutation_lease'),true,'actual SQL mutation lease acquired');check(rpcCalls.includes('custodial_release_application_mutation_lease'),true,'actual SQL lease release invoked');
 }finally{await new Promise(r=>server.close(r));}
 for(const [file,hash] of appliedHashes)check(createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',file))).digest('hex'),hash,`migration unchanged during proof ${file}`);
 console.log(JSON.stringify({status:'PLACE_BRIDGE_DATABASE_PASS',checks,migrations:migrations.length,migration_sha256:appliedHashes.get('20261002160000_place_event_venue_bridge.sql'),absentAutomaticGrants:true,actualReader:true,actualSignedHttpToDatabase:true,actualSqlMutationLease:true,productionWritten:false,eventsConsumerAdopted:false}));
}finally{if(owned){docker(['rm','-f',container]);check(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'','container removed');console.log('OWNED_PLACE_BRIDGE_CONTAINER_REMOVED',container);}}
