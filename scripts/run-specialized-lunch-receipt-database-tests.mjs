import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const container=`mz_schema_rebuild_lunch_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text}).trim();
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);};
let owned=false;const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.length,144,'exact changed-input migration set');
function cleanup(){if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
 removeDefaults();
 for(const file of files){
  assert.equal(sql(defaults),'0','before '+file);const bytes=readFileSync('supabase/migrations/'+file);
  try{sql(bytes);}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  if(Number(sql(defaults))){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();
  }
  assert.equal(sql(defaults),'0','after '+file);manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 for(const script of ['static-weekly-lunch-publication-database-tests.mjs','specialized-lunch-receipt-database-tests.mjs'])
  execFileSync(process.execPath,['scripts/'+script],{env:{...process.env,LUNCH_PUBLICATION_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 assert.equal(sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',migrations:manifest,automatic_grants_absent_before_and_after_each:true,production:false,independent_audit:false}));
}finally{cleanup();}
