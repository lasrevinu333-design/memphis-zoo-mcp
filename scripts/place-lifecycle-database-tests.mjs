import {migrationReplayNames} from './migration-replay-order.mjs';
// Exact migration replay in a disposable, network-isolated DB. No deployment.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const container=`mz_schema_rebuild_places_${process.pid}`;
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,...options});
const raw=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;\n'+text,stdio:['pipe','pipe','pipe']});
const sql=text=>raw(text).trim(),q=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${q(JSON.stringify(value))}::jsonb`;
let checks=0,owned=false;
function check(a,b,name){assert.deepEqual(a,b,name);checks++;}
function rejects(statement,pattern,name){let error;try{sql(statement);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;}
function parallel(statement){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres']);let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve(out.trim()));child.stdin.end('set client_min_messages=warning;\n'+statement);});}
const manager=randomUUID(),inactive=randomUUID();
const commandSql=(id,rev,action,payload={},options={})=>`set role service_role;select public.custodial_place_command(${q(options.request??randomUUID())},${q(options.manager??manager)},${q(id)},${rev},${q(action)},${options.at?q(options.at)+'::timestamptz':'null'},${json(payload)},${q(options.reason??'Fixture manager confirmed preview')});`;
const command=(...args)=>JSON.parse(sql(commandSql(...args)).split('\n').at(-1));
const resolve=(text,at)=>JSON.parse(sql(`set role custodial_application_reader;select public.custodial_place_resolve(${q(text)},${at?q(at)+'::timestamptz':'statement_timestamp()'});`).split('\n').at(-1));
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
function removeDefaults(){for(const owner of ['postgres','supabase_admin'])raw(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);}
const digestTable=table=>sql(`select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from public.${table} r;`);
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log('OWNED_PLACE_TEST_CONTAINER',container);
 const inspection=JSON.parse(docker(['inspect',container]))[0];check(inspection.HostConfig.NetworkMode,'none','no network');check(Object.keys(inspection.HostConfig.PortBindings??{}).length,0,'no ports');
 let ready=0;for(let i=0;i<120&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}check(ready,5,'ready');
 removeDefaults();
 const migrations=migrationReplayNames(root);
 const legacy={};
 for(const [i,file] of migrations.entries()){
  check(sql(defaults),'0',`default grants absent before ${file}`);
  if(file==='20261002100000_place_lifecycle_authority.sql'){
   // A clean schema replay has no production physical catalog. Explicit fixture
   // is created before the place migration/preservation baseline, never inferred.
   sql(`insert into public.locations(id,location_code,location_name,location_type) values(${q(randomUUID())},'PLACE_FIXTURE','Place lifecycle synthetic physical fixture','restroom');`);
   for(const table of ['locations','location_groups','event_venues','events_app_events'])legacy[table]=digestTable(table);
  }
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));raw(bytes);
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  check(sql(defaults),'0',`default grants absent after ${file}`);if((i+1)%25===0)console.log('APPLIED_PLACE_TEST_MIGRATIONS',i+1);
 }
 console.log('EXACT_PLACE_REPLAY_COMPLETE',migrations.length);
 sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Fixture Named Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false),(${q(inactive)},'Fixture Inactive Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],false,false);`);
 const sting=resolve('  StInG - RAYS!! ');check(sting.status,'RESOLVED','normalization');check(sting.cleaning_mode,'NEVER_CLEAN','Stingrays never clean');check(sting.event_eligible,true,'independent event eligibility');
 for(const key of ['schedule_eligible','staffing_eligible','nfc_eligible','overdue_eligible'])check(sting[key],false,`Stingrays ${key} false`);
 const unknownRaw='  Unmapped exhibit: ñ 🦁  ';const unknown=resolve(unknownRaw);check(unknown.raw_location,unknownRaw,'raw event wording verbatim');check(unknown.status,'NEEDS_REVIEW','unknown retained');for(const key of ['schedule_eligible','staffing_eligible','nfc_eligible','overdue_eligible'])check(unknown[key],false,`unknown ${key} false`);
 check(resolve('Courtyard').status,'NEEDS_REVIEW','no historical Stingrays Courtyard defect seeded');
 const a=randomUUID(),b=randomUUID(),c=randomUUID();
 const req=randomUUID();const add={canonical_code:'FIXTURE_A',display_name:'Fixture Alpha',aliases:['F. Alpha','Fixtur Alpa'],cleaning_mode:'NEVER_CLEAN',event_eligible:true};
 check(command(a,0,'add',add,{request:req}).revision,1,'add');check(command(a,0,'add',add,{request:req}).replayed,true,'request replay');
 rejects(commandSql(a,0,'add',{...add,display_name:'changed'},{request:req}),/23505.*identity conflict/s,'same request cannot change');
 check(resolve('f alpha').place_id,a,'abbreviation explicit');check(resolve('fixtur alpa').place_id,a,'misspelling explicit');
 command(a,1,'rename',{display_name:'Fixture Renamed'});check(resolve('Fixture Alpha').place_id,a,'old name retained');check(resolve('Fixture Renamed').place_id,a,'stable canonical ID rename');
 rejects(commandSql(a,1,'deactivate'),/40001.*revision changed/s,'stale preview CAS');
 rejects(commandSql(c,0,'add',{...add,canonical_code:'FIXTURE_COLLISION'}),/23514.*Alias conflicts/s,'alias collision rolls back');check(sql(`select count(*) from public.custodial_places where place_id=${q(c)}`),'0','failed add atomic');
 rejects(commandSql(c,0,'add',{...add,canonical_code:'FIXTURE_PUNCT',display_name:'!!!',aliases:[]}),/22023.*Invalid name/s,'punctuation-only name denied');
 command(b,0,'add',{canonical_code:'FIXTURE_B',display_name:'Fixture Beta',event_eligible:true});
 command(a,2,'merge',{target_place_id:b});check(resolve('Fixture Alpha').place_id,b,'merge canonical root');check(sql(`select count(*) from public.custodial_place_versions where place_id=${q(a)}`),'3','merge preserves revisions');
 rejects(commandSql(b,1,'merge',{target_place_id:a}),/23514.*cycle/s,'merge cycle rejected');
 command(a,3,'reverse');check(resolve('Fixture Alpha').place_id,a,'attributable reversal restores source');
 command(a,4,'deactivate');check(resolve('Fixture Alpha').status,'NEEDS_REVIEW','deactivation');command(a,5,'reactivate');check(resolve('Fixture Alpha').place_id,a,'reactivation same ID');
 const future=new Date(Date.now()+86400000).toISOString(),after=new Date(Date.now()+172800000).toISOString();
 command(a,6,'aliases',{aliases:['Future-only explicit']},{at:future});check(resolve('Future-only explicit').status,'NEEDS_REVIEW','future alias not early');check(resolve('Future-only explicit',after).place_id,a,'future alias effective');
 rejects(commandSql(b,1,'aliases',{aliases:['Future-only explicit']}),/23514.*Alias conflicts/s,'future timeline conflict rejected');
 rejects(commandSql(a,7,'rename',{display_name:'Premature'}),/22023.*monotonically/s,'future timeline cannot be backfilled');
 const preview=JSON.parse(sql(`set role service_role;select public.custodial_place_preview(${q(manager)});`));
 const planned=preview.places.find(p=>p.place_id===a);check(planned.latest_revision,7,'manager preview sees future CAS head');check(planned.effective_snapshot.revision,6,'manager preview distinguishes effective state');
 rejects(`set role service_role;select public.custodial_place_preview(${q(inactive)});`,/42501.*Manager access/s,'inactive preview denied');
 rejects(commandSql(b,1,'rename',{display_name:'unauthorized'},{manager:inactive}),/42501.*Manager access/s,'inactive manager denied');
 rejects(commandSql(b,1,'rename',{display_name:'unknown'},{manager:randomUUID()}),/42501.*Manager access/s,'unknown manager denied');
 rejects(commandSql(sting.place_id,1,'reclassify',{cleaning_mode:'REMINDER_ONLY'}),/23514.*Stingrays remains/s,'Stingrays invariant');
 const physical=sql('select id from public.locations order by id limit 1;');assert.ok(physical,'replay has physical fixture');checks++;
 const scan=randomUUID();command(scan,0,'add',{canonical_code:'FIXTURE_SCAN',display_name:'Fixture Physical',physical_location_id:physical,cleaning_mode:'SCAN_TRACKED',event_eligible:false});
 const notEvent=resolve('Fixture Physical');check(notEvent.cleaning_mode,'SCAN_TRACKED','cleaning mode independent from event eligibility');check(notEvent.status,'NEEDS_REVIEW','not event eligible requires review');check(notEvent.nfc_eligible,false,'Needs Review never routes physical work');
 command(scan,1,'reclassify',{event_eligible:true});check(resolve('Fixture Physical').nfc_eligible,true,'explicit physical mapping');
 command(scan,2,'reclassify',{cleaning_mode:'REMINDER_ONLY'});check(resolve('Fixture Physical').schedule_eligible,true,'reminder eligible');check(resolve('Fixture Physical').nfc_eligible,false,'reminder no NFC');check(resolve('Fixture Physical').overdue_eligible,false,'reminder no NFC overdue');
 rejects(commandSql(scan,3,'merge',{target_place_id:b}),/55000.*verified tag\/schedule cutover/s,'physical merge not falsely safe');
 rejects(commandSql(c,0,'add',{canonical_code:'UNMAPPED_SCAN',display_name:'Unmapped Scan',cleaning_mode:'SCAN_TRACKED'}),/23514.*explicitly mapped/s,'no invented scan mapping');
 const race=await Promise.allSettled([parallel(commandSql(b,1,'rename',{display_name:'Concurrent One'})),parallel(commandSql(b,1,'rename',{display_name:'Concurrent Two'}))]);check(race.filter(r=>r.status==='fulfilled').length,1,'concurrent CAS one winner');check(race.filter(r=>r.status==='rejected').length,1,'concurrent CAS stale caller rejected');
 rejects('delete from public.custodial_place_versions;',/append-only.*forbidden/s,'history no delete');rejects('update public.custodial_places set canonical_code=canonical_code;',/append-only.*forbidden/s,'stable IDs/codes no update');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  for(const table of ['custodial_places','custodial_place_control','custodial_place_versions'])rejects(`set role ${role};select * from public.${table};`,/42501.*permission denied/s,`${role} ${table} denied`);
  rejects(`set role ${role};select public.place_lifecycle_snapshot(${q(a)},now());`,/42501.*permission denied/s,`${role} private helper denied`);
  if(role!=='service_role'){
   rejects(commandSql(a,7,'deactivate').replace('set role service_role',`set role ${role}`),/42501.*permission denied/s,`${role} command denied`);
   rejects(`set role ${role};select public.custodial_place_preview(${q(manager)});`,/42501.*permission denied/s,`${role} preview denied`);
  }
  if(!['service_role','custodial_application_reader'].includes(role))rejects(`set role ${role};select public.custodial_place_resolve('Stingrays',now());`,/42501.*permission denied/s,`${role} resolve denied`);
 }
 const before=digestTable('custodial_place_versions');
 sql('drop function public.custodial_place_resolve(text,timestamptz);');
 raw(sql("select string_agg(definition_sql||';',E'\\n' order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in('function','grant') and object_identity like '%custodial_place_resolve%';"));
 check(resolve('Stingrays').status,'RESOLVED','recovery function and reader ACL');rejects("set role authenticated;select public.custodial_place_resolve('Stingrays',now());",/42501.*permission denied/s,'recovered ACL denies client');check(digestTable('custodial_place_versions'),before,'recovery preserves place history');
 for(const [table,digest] of Object.entries(legacy))check(digestTable(table),digest,`${table} legacy data unchanged`);
 check(sql("select bool_and(relrowsecurity and relforcerowsecurity)::text from pg_class where relname in('custodial_places','custodial_place_control','custodial_place_versions')"),'true','private FORCE RLS');
 check(sql(`select count(*) from public.custodial_place_versions where actor_manager_id=${q(manager)} and length(reason)>0`),sql("select count(*)-1 from public.custodial_place_versions"),'every runtime change attributable');
 console.log(JSON.stringify({status:'PLACE_LIFECYCLE_DATABASE_PASS',checks,migrations:migrations.length,migration_sha256:createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations/20261002100000_place_lifecycle_authority.sql'))).digest('hex'),absentAutomaticGrants:true,legacyConsumersModified:false,productionWritten:false,independentAudit:false}));
}finally{
 if(owned){docker(['rm','-f',container]);check(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'','owned container removed');console.log('OWNED_PLACE_TEST_CONTAINER_REMOVED',container);}
}
