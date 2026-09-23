import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const container='mz_schema_rebuild_roster_'+process.pid;
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
 for(const owner of ['postgres','supabase_admin'])sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role; alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);
 assert.equal(sql("select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)").trim(),'0');
 console.log('AUTOMATIC_PUBLIC_TABLE_AND_SEQUENCE_DATA_API_GRANTS_ABSENT');
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));
  sql(bytes);records.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),exit:0});
  if(records.length%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',records.length);
 }
 console.log('COMPLETE_SCHEMA',records.length);
 if(process.env.VACANCY_SCHEMA_RECORDS)writeFileSync(process.env.VACANCY_SCHEMA_RECORDS,JSON.stringify(records,null,2)+'\n',{flag:'wx'});
 if(process.env.VACANCY_REFRESH_CATALOG==='1')execFileSync(process.execPath,[path.join(root,'scripts/refresh-schema-fingerprint.mjs')],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:'postgres'},stdio:'inherit',timeout:180000});
 execFileSync(process.execPath,[path.join(root,'scripts/static-weekly-midweek-vacancy-database-fixture.mjs')],{cwd:root,env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 execFileSync(process.execPath,[path.join(root,'scripts/static-weekly-vacate-roster-slot-fixture-tests.mjs')],{cwd:root,env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 console.log('STATIC_WEEKLY_VACATE_ROSTER_SLOT_DATABASE_PASS');
}finally{
 if(owned){docker(['rm','-f',container]);assert.equal(docker(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
}
