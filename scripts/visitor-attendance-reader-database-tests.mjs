import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {visitorDatabaseBoundaryProof} from './fixtures/visitor-attendance-database-boundary-fixture.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const container='mz_schema_rebuild_attendance_'+process.pid;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text});
let owned=false;const records=[];
const socketParent=mkdtempSync(path.join(tmpdir(),'custodial-visitor-pg-'));
const socketDir=path.join(socketParent,'socket');mkdirSync(socketDir);chmodSync(socketDir,0o777);
console.log('OWNED_TEST_SOCKET',socketParent,'cleanup=remove exact disposable directory after database shutdown');
const noAutomaticGrants=process.env.ATTENDANCE_NO_AUTOMATIC_GRANTS==='1';
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
function removeAutomaticDefaults(){for(const role of ['postgres','supabase_admin'])sql(`alter default privileges for role ${role} in schema public revoke all on tables from anon,authenticated,service_role; alter default privileges for role ${role} in schema public revoke all on sequences from anon,authenticated,service_role;`);}
function cleanup(){
 if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
 if(existsSync(socketParent)){rmSync(socketParent,{recursive:true,force:false});console.log('OWNED_TEST_SOCKET_REMOVED',socketParent);}
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','--mount',`type=bind,src=${socketDir},dst=/audit-pg-socket`,'-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','unix_socket_directories=/var/run/postgresql,/audit-pg-socket']);
 owned=true;console.log('OWNED_TEST_CONTAINER',container);
 const info=JSON.parse(docker(['inspect',container]))[0];
 assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
 let consecutive=0;
 for(let attempt=0;attempt<120&&consecutive<5;attempt++){
  try{sql('select 1');consecutive++;}catch{consecutive=0;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(consecutive,5,'isolated test database ready');
 assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").trim(),'0');
 sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
 if(noAutomaticGrants)removeAutomaticDefaults();
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  if(noAutomaticGrants)assert.equal(sql(defaults).trim(),'0','no automatic table/sequence grants before '+file);
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));
  sql(bytes);records.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),exit:0});
  if(noAutomaticGrants&&sql(defaults).trim()!=='0'){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file),'known historic default grant writer');
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i,'historic default writer creates no tables/sequences');
   removeAutomaticDefaults();console.log('DISPOSABLE_DEFAULT_RESET',file);
  }
  if(noAutomaticGrants)assert.equal(sql(defaults).trim(),'0','no automatic table/sequence grants after '+file);
  if(records.length%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',records.length);
 }
 console.log('COMPLETE_SCHEMA',records.length);
 console.log('AUTOMATIC_GRANTS_ABSENT_THROUGH_REPLAY',noAutomaticGrants);
 if(process.env.ATTENDANCE_SCHEMA_RECORDS)writeFileSync(process.env.ATTENDANCE_SCHEMA_RECORDS,JSON.stringify(records,null,2)+'\n',{flag:'wx'});
 if(process.env.ATTENDANCE_REFRESH_CATALOG==='1'){
  assert.equal(noAutomaticGrants,false,'canonical target uses existing production default privilege model');
  execFileSync(process.execPath,[path.join(root,'scripts/refresh-schema-fingerprint.mjs')],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:'postgres'},stdio:'inherit',timeout:180000});
 }

 sql("insert into public.current_attendance_state(id,attendance,last_year,planned,yesterday,yesterday_plan,source,fetched_at,updated_at) values(1,0,10,20,15,25,'synthetic-visitor-test',now(),now())");
 assert.equal(sql("set role custodial_application_reader; select attendance::text from public.current_attendance_state where id=1").trim().split('\\n').at(-1),'0','reader sees actual zero through forced RLS');
 assert.equal(sql("select has_table_privilege('custodial_application_reader','public.current_attendance_state','INSERT')::text").trim(),'false');
 assert.equal(sql("select has_table_privilege('custodial_application_reader','public.current_attendance_state','UPDATE')::text").trim(),'false');
 assert.equal(sql("select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='policy' and object_identity='public.current_attendance_state:custodial_reader_current_visitor_attendance' and definition_sql=public.custodial_release_authority_current_policy_definition(object_identity)").trim(),'1');
 sql("update public.current_attendance_state set attendance=125 where id=1");
 assert.equal(sql("set role custodial_application_reader; select attendance::text from public.current_attendance_state where id=1").trim().split('\\n').at(-1),'125');
 let passed=5;
 const q=value=>`'${String(value).replaceAll("'","''")}'`;
 const observation={attendance:200,last_year:100,planned:400,yesterday:150,yesterday_plan:175,source:'synthetic-visitor-test',fetched_at:new Date(Date.parse(sql('select clock_timestamp()::text').trim())+10000).toISOString()};
 const push=payload=>sql(`set role service_role; select public.app_apply_operational_command('attendance_state_upsert',${q(JSON.stringify(payload))}::jsonb)::text`);
 assert.equal(JSON.parse(push(observation)).ok,true);passed++;
 const older={...observation,attendance:150,fetched_at:new Date(Date.parse(observation.fetched_at)-1000).toISOString()};
 assert.throws(()=>push(older),/older than or conflicts/);passed++;
 assert.equal(sql('select attendance::text from public.current_attendance_state where id=1').trim(),'200');passed++;
 assert.equal(JSON.parse(push(observation)).ok,true,'exact replay accepted');passed++;
 for(const field of ['last_year','planned','yesterday','yesterday_plan','source']){
  assert.throws(()=>push({...observation,[field]:field==='source'?'conflict':999}),/older than or conflicts/);passed++;
 }
 const newerZero={...observation,attendance:0,fetched_at:new Date(Date.parse(observation.fetched_at)+1000).toISOString()};
 assert.equal(JSON.parse(push(newerZero)).ok,true,'newer lower count and genuine zero remain valid');passed++;
 assert.equal(sql('select attendance::text from public.current_attendance_state where id=1').trim(),'0');passed++;
 // Real recovery execution in this disposable database, not merely hash equality.
 sql('drop policy custodial_reader_current_visitor_attendance on public.current_attendance_state');
 assert.equal(sql('set role custodial_application_reader; select count(*)::text from public.current_attendance_state').trim(),'0');passed++;
 sql("do $$ declare definition text; begin select definition_sql into strict definition from public.custodial_release_authority_restore_inventory where object_kind='policy' and object_identity='public.current_attendance_state:custodial_reader_current_visitor_attendance'; execute definition; end $$");
 assert.equal(sql('set role custodial_application_reader; select attendance::text from public.current_attendance_state where id=1').trim(),'0');passed++;
 sql("do $$ declare definition text; begin select definition_sql into strict definition from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity='public.app_apply_operational_command(text,jsonb)'; execute definition; end $$");
 assert.throws(()=>push(older),/older than or conflicts/,'restored function preserves timestamp ordering');passed++;
 assert.equal(JSON.parse(push(newerZero)).ok,true,'restored function preserves exact replay');passed++;
 console.log(JSON.stringify({passed,failed:0,readerVisible:true,readerCanWrite:false,policyRestoreExecuted:true,productionWritten:false}));
 await visitorDatabaseBoundaryProof({socketDir,sql});
 console.log('VISITOR_ATTENDANCE_READER_DATABASE_PASS');
}finally{
 cleanup();
}
