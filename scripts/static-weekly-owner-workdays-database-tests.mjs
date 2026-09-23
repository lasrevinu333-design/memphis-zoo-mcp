import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ownerWorkdaysDatabaseProof} from './fixtures/owner-workdays-database-fixture.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const container='mz_schema_rebuild_owner_'+process.pid;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text});
const socketParent=mkdtempSync(path.join(tmpdir(),'custodial-owner-pg-'));
const socketDir=path.join(socketParent,'socket');mkdirSync(socketDir);chmodSync(socketDir,0o777);
console.log('OWNED_TEST_SOCKET',socketParent,'cleanup=remove exact disposable directory after shutdown');
let owned=false;
function cleanup(){
 if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
 if(existsSync(socketParent)){rmSync(socketParent,{recursive:true,force:false});console.log('OWNED_TEST_SOCKET_REMOVED',socketParent);}
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
function removeDefaults(){for(const role of ['postgres','supabase_admin'])sql(`alter default privileges for role ${role} in schema public revoke all on tables from anon,authenticated,service_role; alter default privileges for role ${role} in schema public revoke all on sequences from anon,authenticated,service_role;`);}
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','--mount',`type=bind,src=${socketDir},dst=/audit-pg-socket`,'-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','unix_socket_directories=/var/run/postgresql,/audit-pg-socket']);
 owned=true;console.log('OWNED_TEST_CONTAINER',container,'cleanup=remove exact container in finally');
 const info=JSON.parse(docker(['inspect',container]))[0];assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
 let consecutive=0;
 for(let attempt=0;attempt<120&&consecutive<5;attempt++){
  try{sql('select 1');consecutive++;}catch{consecutive=0;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(consecutive,5,'isolated database ready');
 assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").trim(),'0');
 sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
 removeDefaults();let applied=0;
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  assert.equal(sql(defaults).trim(),'0','defaults absent before '+file);
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));sql(bytes);applied++;
  if(sql(defaults).trim()!=='0'){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);
   removeDefaults();console.log('DISPOSABLE_DEFAULT_RESET',file);
  }
  assert.equal(sql(defaults).trim(),'0','defaults absent after '+file);
  if(applied%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',applied);
 }
 console.log('COMPLETE_SCHEMA',applied,'AUTOMATIC_GRANTS_ABSENT_THROUGH_REPLAY');
 await ownerWorkdaysDatabaseProof({socketDir,sql,container});
 console.log('OWNER_WORKDAYS_REAL_CONTROL_PLANE_DATABASE_PASS');
}finally{cleanup();}
