import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const container='mz_schema_rebuild_attendance_'+process.pid;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text});
let owned=false;const records=[];
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
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
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));
  sql(bytes);records.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),exit:0});
  if(records.length%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',records.length);
 }
 console.log('COMPLETE_SCHEMA',records.length);
 if(process.env.ATTENDANCE_SCHEMA_RECORDS)writeFileSync(process.env.ATTENDANCE_SCHEMA_RECORDS,JSON.stringify(records,null,2)+'\n',{flag:'wx'});
 if(process.env.ATTENDANCE_REFRESH_CATALOG==='1')execFileSync(process.execPath,[path.join(root,'scripts/refresh-schema-fingerprint.mjs')],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:'postgres'},stdio:'inherit',timeout:180000});

 sql("insert into public.current_attendance_state(id,attendance,last_year,planned,yesterday,yesterday_plan,source,fetched_at,updated_at) values(1,0,10,20,15,25,'synthetic-visitor-test',now(),now())");
 assert.equal(sql("set role custodial_application_reader; select attendance::text from public.current_attendance_state where id=1").trim().split('\\n').at(-1),'0','reader sees actual zero through forced RLS');
 assert.equal(sql("select has_table_privilege('custodial_application_reader','public.current_attendance_state','INSERT')::text").trim(),'false');
 assert.equal(sql("select has_table_privilege('custodial_application_reader','public.current_attendance_state','UPDATE')::text").trim(),'false');
 assert.equal(sql("select count(*)::text from public.custodial_release_authority_restore_inventory where object_kind='policy' and object_identity='public.current_attendance_state:custodial_reader_current_visitor_attendance' and definition_sql=public.custodial_release_authority_current_policy_definition(object_identity)").trim(),'1');
 sql("update public.current_attendance_state set attendance=125 where id=1");
 assert.equal(sql("set role custodial_application_reader; select attendance::text from public.current_attendance_state where id=1").trim().split('\\n').at(-1),'125');
 console.log(JSON.stringify({passed:5,failed:0,readerVisible:true,readerCanWrite:false,productionWritten:false}));
 console.log('VISITOR_ATTENDANCE_READER_DATABASE_PASS');
}finally{
 if(owned){docker(['rm','-f',container]);assert.equal(docker(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
}
