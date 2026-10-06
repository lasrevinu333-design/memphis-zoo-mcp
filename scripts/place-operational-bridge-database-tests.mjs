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
const container=`mz_schema_rebuild_place_source_${process.pid}`;
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

 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic Source Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false),(${q(otherManager)},'Synthetic Other Source Manager',array['CUSTODIAL_MANAGER','OPS_MANAGER'],true,false);`);
 const physical=randomUUID(),physicalB=randomUUID(),group=randomUUID(),emptyGroup=randomUUID();
 sql(`insert into public.locations(id,location_code,location_name,location_type,nfc_url,scan_router_url) values(${q(physical)},'SOURCE_A','Source physical A','restroom','protected-original-tag-A','original-router-A'),(${q(physicalB)},'SOURCE_B','Source physical B','restroom','protected-original-tag-B','original-router-B');
 insert into public.location_groups(id,group_code,group_name) values(${q(group)},'SOURCE_GROUP','Source many member group'),(${q(emptyGroup)},'SOURCE_EMPTY','Source empty reminder');
 insert into public.location_group_memberships(location_group_id,location_id,active) values(${q(group)},${q(physical)},true),(${q(group)},${q(physicalB)},false);`);
 const person=randomUUID(),handset=randomUUID(),phoneCredential=randomUUID(),protectedContext=randomUUID();
 sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${q(person)},'EMP_SOURCE_HISTORY','Synthetic original work actor','staff',true);
 insert into public.devices(id,device_id,device_name,assigned_employee_id,assignment_epoch) values(${q(handset)},'SOURCE_HISTORY_DEVICE','Synthetic history handset',${q(person)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at) values(${q(phoneCredential)},${q(handset)},repeat('e',64),'Synthetic history credential',now(),now()+interval '1 day');
 insert into public.custodial_offline_actor_contexts(context_id,client_session_id,device_id,employee_id,credential_id,assignment_epoch,location_id,canonical_location_code,started_at,occurrence_fingerprint,expires_at)
 values(${q(protectedContext)},'source-protected-original-work',${q(handset)},${q(person)},${q(phoneCredential)},1,${q(physical)},'SOURCE_A',now(),repeat('a',64),now()+interval '1 day');`);
 const originalContext=sql(`select to_jsonb(x)::text from public.custodial_offline_actor_contexts x where context_id=${q(protectedContext)}`);
 const coreDefinitions=sql("select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by oid::regprocedure::text)) from pg_proc where pronamespace='public'::regnamespace and proname in('tool_get_location_scan_state','tool_get_location_scan_state_v2','tool_start_offline_occurrence','tool_finish_session','tool_complete_session','tool_commit_cleaning_workflow_authoritative')");
 const original=Object.fromEntries(['locations','location_groups','location_group_memberships','custodial_offline_actor_contexts','weekly_schedule_publications','events_app_events'].map(t=>[t,digest(t)]));
 const prepareSql=(kind,id,action,payload={},at=null,actor=manager)=>`set role service_role;select public.custodial_place_source_preview(${q(actor)},${q(kind)},${id?q(id)+'::uuid':'null'},${q(action)},${j(payload)},${at?q(at)+'::timestamptz':'null'},'Explicit synthetic metadata proposal');`;
 const prepare=(...args)=>JSON.parse(sql(prepareSql(...args)).split('\n').at(-1));
 const sendSql=(preview,request=randomUUID(),actor=manager)=>`set role service_role;select public.custodial_place_source_confirm(${q(request)},${q(actor)},${q(preview)});`;
 const send=(...args)=>JSON.parse(sql(sendSql(...args)).split('\n').at(-1));
 const read=(at=null)=>JSON.parse(sql(`begin read only;set local role custodial_application_reader;select public.custodial_place_source_overlay(${at?q(at)+'::timestamptz':'statement_timestamp()'});rollback;`).split('\n').at(-1));
 const enroll=(kind,id,code,name,mode)=>{const p=prepare(kind,id,'enroll',{canonical_code:code,display_name:name,aliases:[],cleaning_mode:mode,event_eligible:false});return send(p.preview_id);};
 const a=enroll('physical_location',physical,'SOURCE_CANON_A','Canonical physical A','SCAN_TRACKED'),b=enroll('physical_location',physicalB,'SOURCE_CANON_B','Canonical physical B','SCAN_TRACKED');
 const g=enroll('location_group',group,'SOURCE_CANON_GROUP','Canonical many member group','SCAN_TRACKED'),e=enroll('location_group',emptyGroup,'SOURCE_CANON_EMPTY','Canonical empty reminder','REMINDER_ONLY');
 check(read().records.find(x=>x.legacy_id===group).source_member_location_ids.sort(),[physical,physicalB].sort(),'all distinct membership evidence including inactive retained');
 check(sql(`select physical_location_id is null from public.custodial_places where place_id=${q(g.data.place_id)}`),'t','group has no fake physical FK');
 check(read().records.find(x=>x.legacy_id===emptyGroup).proposed_included_locations,[],'empty reminder has no physical work');
 for(const [t,h] of Object.entries(original))check(digest(t),h,`${t} unchanged by explicit enrollment`);
 let p=prepare('physical_location',physical,'rename',{display_name:'Renamed physical A'}),request=randomUUID(),r=send(p.preview_id,request);
 const originalPreview=p.preview_id;
 check(r.data.revision,2,'rename appended');check(send(p.preview_id,request).replayed,true,'exact receipt replay');
 rejects(sendSql(p.preview_id,request,otherManager),/23505.*identity conflict/s,'foreign actor replay');
 rejects(sendSql(randomUUID(),request),/23505.*identity conflict/s,'foreign preview replay');
 check(read().records.find(x=>x.legacy_id===physical).effective_snapshot.aliases.includes('Canonical physical A'),true,'old name retained alias');
 p=prepare('physical_location',physical,'deactivate');send(p.preview_id);check(read().records.find(x=>x.legacy_id===physical).mapping_status,'INACTIVE','logical deactivate');
 send(prepare('physical_location',physical,'reactivate').preview_id);
 p=prepare('physical_location',physical,'merge',{target_legacy_id:physicalB});const merged=send(p.preview_id);
 let row=read().records.find(x=>x.legacy_id===physical);check(row.mapping_status,'LOGICALLY_MERGED','physical logical merge admitted');
 check(row.legacy_id,physical,'original route UUID survives');check(row.raw_legacy.location_code,'SOURCE_A','original code survives');check(row.canonical_root_id,b.data.place_id,'root is separate canonical UUID');
 rejects(`set role service_role;select public.custodial_place_command(${q(randomUUID())},${q(manager)},${q(b.data.place_id)},1,'merge',null,${j({target_place_id:a.data.place_id})},'Ordinary unadmitted physical merge');`,/55000.*Physical-place merge/s,'ordinary physical merge guard retained');
 rejects(`set role service_role;set custodial.place_merge_admission='true';select public.place_source_apply(${q(merged.request_id)},${q(manager)},${q(merged.preview_id)},now());`,/42501.*permission denied/s,'forgeable setting cannot call private admission');
 rejects(`select public.place_source_apply(${q(merged.request_id)},${q(manager)},${q(merged.preview_id)},now());`,/42501.*current-transaction/s,'owner replay outside admission transaction denied');
 send(prepare('physical_location',physical,'reverse').preview_id);check(read().records.find(x=>x.legacy_id===physical).mapping_status,'MAPPED','logical merge reversal');
 const stale=prepare('physical_location',physical,'aliases',{aliases:['Explicit synonym A']});
 send(prepare('physical_location',physical,'rename',{display_name:'Current physical A'}).preview_id);
 rejects(sendSql(stale.preview_id),/40001.*(revision changed|Source\/dependencies changed)/s,'source CAS');
 const targetStale=prepare('physical_location',physical,'merge',{target_legacy_id:physicalB});
 send(prepare('physical_location',physicalB,'rename',{display_name:'Current physical B'}).preview_id);
 rejects(sendSql(targetStale.preview_id),/40001.*(revision changed|Source\/dependencies changed)/s,'target CAS');
 rejects(prepareSql('physical_location',physical,'merge',{target_legacy_id:group}),/23514.*same-namespace/s,'cross namespace merge refused');
 rejects(prepareSql('location_group',emptyGroup,'reclassify',{cleaning_mode:'SCAN_TRACKED'}),/23514.*physical members/s,'empty scan group refused');
 rejects(prepareSql('physical_location',physical,'memberships',{member_location_ids:[physicalB]}),/22023.*group member/s,'physical group flattening denied');
 const fresh=prepare('location_group',group,'memberships',{member_location_ids:[physical]});send(fresh.preview_id);
 check(read().records.find(x=>x.legacy_id===group).source_member_location_ids,[physical],'desired membership version explicit');
 check(digest('location_group_memberships'),original.location_group_memberships,'existing physical membership rows untouched');
 // Dependency table lock is part of each confirmation; actual source-writer
 // concurrency below proves no check-then-write admission window.
 const sourcePreview=prepare('physical_location',physical,'rename',{display_name:'After changed catalog'});
 sql(`update public.locations set location_name='Synthetic changed legacy bytes' where id=${q(physicalB)}`);
 rejects(sendSql(sourcePreview.preview_id),/40001.*Source\/dependencies changed/s,'full catalog drift CAS');
 const dependencyPreview=prepare('physical_location',physical,'rename',{display_name:'After changed protected dependency'});
 sql(`insert into public.custodial_offline_actor_contexts(client_session_id,device_id,employee_id,credential_id,assignment_epoch,location_id,canonical_location_code,started_at,occurrence_fingerprint,expires_at)
 values('source-additional-protected-work',${q(handset)},${q(person)},${q(phoneCredential)},1,${q(physicalB)},'SOURCE_B',now(),repeat('b',64),now()+interval '1 day');`);
 rejects(sendSql(dependencyPreview.preview_id),/40001.*Source\/dependencies changed/s,'actual protected-context dependency CAS');
 original.custodial_offline_actor_contexts=digest('custodial_offline_actor_contexts'); // Intentional fixture addition only.
 const future=sql("select (clock_timestamp()+interval '1 hour')::text");
 p=prepare('physical_location',physical,'deactivate',{},future);send(p.preview_id);
 check(read().records.find(x=>x.legacy_id===physical).mapping_status,'MAPPED','future state not current');
 check(read(future).records.find(x=>x.legacy_id===physical).mapping_status,'INACTIVE','future state effective separately');
 rejects(prepareSql('physical_location',physical,'rename',{display_name:'Bad backfill'}),/22023.*latest planned/s,'future head prohibits backfill');
 const add=prepare('physical_location',null,'add',{canonical_code:'NEW_SOURCE_PHYSICAL',legacy_code:'NEW_SOURCE_ROUTE',display_name:'New setup pending physical',location_type:'restroom',cleaning_mode:'SCAN_TRACKED',event_eligible:false,aliases:[]});
 const added=send(add.preview_id);row=read().records.find(x=>x.legacy_id===added.data.legacy_id);
 check(row.mapping_status,'SETUP_PENDING','new physical setup pending');check(row.new_scan_authority,false,'no new scan authority');
 check(sql(`select jsonb_build_array(active,nfc_url,scan_router_url,form_url)::text from public.locations where id=${q(added.data.legacy_id)}`),'[false, null, null, null]','new real physical row inactive without routing');
 const newGroup=prepare('location_group',null,'add',{canonical_code:'NEW_REMINDER_SOURCE',legacy_code:'NEW_REMINDER_GROUP',display_name:'New setup reminder group',cleaning_mode:'REMINDER_ONLY',event_eligible:true,aliases:[],member_location_ids:[physicalB],metadata:{schedule_eligible:true,staffing_eligible:false,coordinates:{latitude:35.1,longitude:-89.9}}});
 const addedGroup=send(newGroup.preview_id);check(read().records.find(x=>x.legacy_id===addedGroup.data.legacy_id).source_member_location_ids,[physicalB],'new group explicit proposed member retained');
 check(sql(`select count(*) from public.location_group_memberships where location_group_id=${q(addedGroup.data.legacy_id)}`),'0','pending new group does not steal legacy member');
 check(digest('location_group_memberships'),original.location_group_memberships,'pending new group retains all original physical group relationships');
 const existingReminder=group;send(prepare('location_group',group,'reclassify',{cleaning_mode:'REMINDER_ONLY'}).preview_id);
 send(prepare('location_group',emptyGroup,'merge',{target_legacy_id:existingReminder}).preview_id);
 row=read().records.find(x=>x.legacy_id===emptyGroup);check(row.mapping_status,'LOGICALLY_MERGED','group logical merge');
 check(row.source_member_location_ids,[],'group source not flattened');check(row.proposed_consolidation_member_location_ids,[physical],'explicit proposed merged membership union');
 check(row.proposed_included_locations,[],'reminder group merge still no physical duty');send(prepare('location_group',emptyGroup,'reverse').preview_id);
 const mode=prepare('location_group',emptyGroup,'reclassify',{cleaning_mode:'NEVER_CLEAN',event_eligible:true,metadata:{schedule_eligible:false,staffing_eligible:false}});send(mode.preview_id);
 row=read().records.find(x=>x.legacy_id===emptyGroup);check(row.effective_snapshot.cleaning_mode,'NEVER_CLEAN','independent cleaning mode');check(row.effective_snapshot.event_eligible,true,'independent event capability');
 send(prepare('location_group',emptyGroup,'reverse').preview_id);check(read().records.find(x=>x.legacy_id===emptyGroup).effective_snapshot.cleaning_mode,'REMINDER_ONLY','classification reversal');
 const expire=prepare('location_group',emptyGroup,'aliases',{aliases:['Deliberate abbreviation']});
 sql(`alter table public.custodial_place_source_previews disable trigger place_source_immutable;update public.custodial_place_source_previews set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where preview_id=${q(expire.preview_id)};alter table public.custodial_place_source_previews enable trigger place_source_immutable;`);
 rejects(sendSql(expire.preview_id),/40001.*expired/s,'server preview expiry');
 const revoked=prepare('location_group',emptyGroup,'aliases',{aliases:['Second manager proposed']},null,otherManager);sql(`update public.ops_manager_managers set active=false where manager_id=${q(otherManager)}`);
 rejects(sendSql(revoked.preview_id,randomUUID(),otherManager),/42501|active|manager/i,'current manager revoked between preview/confirm');sql(`update public.ops_manager_managers set active=true where manager_id=${q(otherManager)}`);
 rejects(prepareSql('location_group',null,'add',{canonical_code:'BAD',legacy_code:'BAD',display_name:'Bad metadata',aliases:[],cleaning_mode:'REMINDER_ONLY',event_eligible:true,metadata:{coordinates:{latitude:91,longitude:0}}}),/22023.*coordinates/s,'out of range coordinate denied');
 rejects(prepareSql('physical_location',physical,'enroll',{canonical_code:'DOUBLE',display_name:'Duplicate',aliases:[],cleaning_mode:'NEVER_CLEAN',event_eligible:false}),/23505.*already enrolled/s,'no duplicate enrollment');
 rejects(prepareSql('location_group',emptyGroup,'aliases',{aliases:['Canonical many member group']}),/23514.*alias conflicts/s,'server preview refuses conflicting canonical alias');
 sql(`alter table public.custodial_place_source_previews disable trigger place_source_immutable;update public.custodial_place_source_previews set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where preview_id=${q(originalPreview)};alter table public.custodial_place_source_previews enable trigger place_source_immutable;`);
 check(send(originalPreview,request).replayed,true,'original receipt recovers after source/future/original-preview expiry changes');
 const race1=prepare('location_group',emptyGroup,'rename',{display_name:'Race empty reminder'}),race2=prepare('location_group',emptyGroup,'rename',{display_name:'Other race empty reminder'});
 const race=await Promise.allSettled([parallel(sendSql(race1.preview_id)),parallel(sendSql(race2.preview_id))]);check(race.filter(x=>x.status==='fulfilled').length,1,'CAS concurrent single winner');check(race.filter(x=>x.status==='rejected').length,1,'CAS concurrent loser');
 const writerPreview=prepare('location_group',emptyGroup,'rename',{display_name:'Writer-race empty reminder'});
 let signal;const locked=new Promise(r=>signal=r),writer=spawn('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres']);let out='',err='';
 writer.stdout.on('data',b=>{out+=b;if(out.includes('WRITER_LOCKED'))signal();});writer.stderr.on('data',b=>err+=b);
 const done=new Promise((r,j)=>{writer.on('error',j);writer.on('close',c=>c?j(new Error(err)):r());});
 writer.stdin.end(`begin;lock table public.locations in row exclusive mode;select 'WRITER_LOCKED';select pg_sleep(1);update public.locations set location_name='Committed concurrent catalog' where id=${q(physicalB)};commit;`);
 await locked;let error;try{await parallel(sendSql(writerPreview.preview_id));}catch(e){error=e;}await done;assert.match(String(error),/Source\/dependencies changed/);checks++;
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  for(const table of ['custodial_place_source_previews','custodial_place_source_versions','custodial_place_source_admissions'])rejects(`set role ${role};select * from public.${table}`,/42501.*permission denied/s,`${role} private ${table} denied`);
  rejects(`set role ${role};select public.place_source_apply(${q(randomUUID())},${q(manager)},${q(randomUUID())},now())`,/42501.*permission denied/s,`${role} private helper denied`);
  if(role!=='service_role'){rejects(prepareSql('location_group',emptyGroup,'rename',{display_name:'Denied'}).replace('set role service_role',`set role ${role}`),/42501.*permission denied/s,`${role} preview denied`);rejects(sendSql(p.preview_id).replace('set role service_role',`set role ${role}`),/42501.*permission denied/s,`${role} confirm denied`);}
  if(!['service_role','custodial_application_reader'].includes(role))rejects(`set role ${role};select public.custodial_place_source_overlay(now())`,/42501.*permission denied/s,`${role} read denied`);
 }
 rejects('delete from public.custodial_place_source_versions',/append-only.*forbidden/s,'append only history');
 check(sql("select bool_and(relrowsecurity and relforcerowsecurity)::text from pg_class where relname in('custodial_place_source_previews','custodial_place_source_versions','custodial_place_source_admissions')"),'true','private FORCE RLS');
 const history=digest('custodial_place_source_versions');sql('drop function public.custodial_place_source_overlay(timestamptz)');
 raw(sql("select string_agg(definition_sql||';',E'\\n' order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and object_identity like '%custodial_place_source_overlay%';"));
 check(read().operational_cutover,false,'exact reader recovered');check(digest('custodial_place_source_versions'),history,'recovery history unchanged');
 raw(sql("select string_agg('drop function '||object_identity||';',E'\\n' order by restore_order desc) from public.custodial_release_authority_restore_inventory where object_kind='function' and (object_identity like '%place_source_%' or object_identity like '%custodial_place_source_%');"));
 raw(sql("select string_agg(definition_sql||';',E'\\n' order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and (object_identity like '%place_source_%' or object_identity like '%custodial_place_source_%');"));
 check(read().operational_cutover,false,'all owning functions/grants recovered in dependency-safe order');check(digest('custodial_place_source_versions'),history,'complete owning function recovery preserves history');
 rejects('set role authenticated;select public.custodial_place_source_overlay(now())',/42501.*permission denied/s,'full function recovery keeps client denied');
 for(const table of ['custodial_offline_actor_contexts','weekly_schedule_publications','events_app_events'])check(digest(table),original[table],`${table} immutable protected history`);
 check(sql(`select to_jsonb(x)::text from public.custodial_offline_actor_contexts x where context_id=${q(protectedContext)}`),originalContext,'populated original Finish context byte-identical through merge/reclassify/deactivate');
 check(sql("select md5(string_agg(pg_get_functiondef(oid),E'\\n' order by oid::regprocedure::text)) from pg_proc where pronamespace='public'::regnamespace and proname in('tool_get_location_scan_state','tool_get_location_scan_state_v2','tool_start_offline_occurrence','tool_finish_session','tool_complete_session','tool_commit_cleaning_workflow_authoritative')"),coreDefinitions,'existing operational Start/Finish definitions untouched');

 const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-bridge-http-test-secret'},credential=randomUUID(),device='BRIDGE_SYNTHETIC_HTTP';
 const named={manager_id:otherManager,display_name:'Synthetic Second Bridge Manager',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true,revoked_at:null};
 const trusted={credential_id:credential,device_id:device,device_label:device,token_hash:'synthetic-only',max_access_level:'full_access',manager_id:otherManager,manager:named,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
 const rpcCalls=[],allowed=new Set(['custodial_place_preview','custodial_place_source_preview','custodial_place_source_confirm','custodial_place_source_overlay','custodial_begin_application_mutation_lease','custodial_heartbeat_application_mutation_lease','custodial_release_application_mutation_lease']);
 const client={rpc:async(name,args)=>{
  assert.ok(allowed.has(name));rpcCalls.push(name);
  const argumentsSql=Object.entries(args).map(([key,value])=>{assert.match(key,/^p_[a-z_]+$/);return `${key} => ${value===null?'null':typeof value==='number'?value:typeof value==='object'?j(value):q(value)}`;}).join(',');
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
  check((await http('/source/overlay',{authenticated:false})).status,401,'real signed HTTP no identity denied');
  check((await http('/source/overlay',{access:'read_only'})).status,403,'real signed HTTP readonly denied');
  check((await http('/source/overlay')).body.data.operational_cutover,false,'real signed HTTP source reader');
  const prepared=await http('/source/preview',{body:{legacy_kind:'location_group',legacy_id:emptyGroup,action:'reclassify',payload:{event_eligible:true},effective_at:null,reason:'Second manager HTTP metadata confirmation'}});
  check(prepared.status,200,'actual HTTP SQL preview');check(prepared.body.data.actor_manager_id,otherManager,'server second manager actor');
  const command={request_id:randomUUID(),preview_id:prepared.body.data.preview_id},sent=await http('/source/confirm',{body:command});
  check(sent.status,200,'actual HTTP SQL confirm');check(sent.body.request_id,command.request_id,'actual bound HTTP request');
  check(sent.body.data.legacy_id,emptyGroup,'actual HTTP namespace UUID');check(sent.body.data.actor_manager_id,otherManager,'actual authenticated actor');
  check(sent.body.operational_cutover,false,'HTTP no implicit cutover');check((await http('/source/confirm',{body:command})).body.replayed,true,'actual HTTP exact replay');
  check((await http('/source/confirm',{body:{...command,manager_id:manager}})).status,422,'HTTP actor spoof denied');
  check(rpcCalls.includes('custodial_begin_application_mutation_lease'),true,'actual SQL mutation lease acquired');
  check(rpcCalls.includes('custodial_release_application_mutation_lease'),true,'actual SQL mutation lease released');
 }finally{await new Promise(r=>server.close(r));}
 for(const [file,hash] of appliedHashes)check(createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',file))).digest('hex'),hash,`migration unchanged during proof ${file}`);
 console.log(JSON.stringify({status:'PLACE_SOURCE_DATABASE_PASS',checks,migrations:migrations.length,migration_sha256:appliedHashes.get('20261002200000_place_operational_metadata_bridge.sql'),absentAutomaticGrants:true,actualReader:true,productionWritten:false,operationalCutover:false}));
}finally{if(owned){docker(['rm','-f',container]);check(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'','container removed');console.log('OWNED_PLACE_SOURCE_CONTAINER_REMOVED',container);}}
