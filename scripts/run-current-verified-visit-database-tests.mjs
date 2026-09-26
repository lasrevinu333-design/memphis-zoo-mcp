#!/usr/bin/env node
// Disposable current-head proof for the exact verified-visit/dashboard read path.
// The historical OC24 runner remains pinned to its original 150-migration head.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const container=`mz_verified_visit_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const files=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort();
assert.equal(files.length,153,'current changed-input migration count');
assert.equal(files.at(-1),'20260925190000_gps_exact_location_authority_boundary.sql','current changed-input migration head');
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,...options});
const sql=statement=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:statement}).trim();
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['', 'in schema public'])sql(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role; alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
let owned=false;
function cleanup(){if(!owned)return;docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log('OWNED_CONTAINER',container,'network=none production=false');
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(resolve=>setTimeout(resolve,500));}assert.equal(ready,4);
 removeDefaults();
 const hashes=[];
 for(const file of files){
  assert.equal(sql(defaults),'0',`no automatic grants before ${file}`);
  const bytes=readFileSync(`supabase/migrations/${file}`);
  try{sql(bytes);}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  if(Number(sql(defaults))){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);
   removeDefaults();
  }
  assert.equal(sql(defaults),'0',`no automatic grants after ${file}`);
  hashes.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(hashes.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',hashes.length);
 }
 execFileSync(process.execPath,['scripts/gps-authority-boundary-database-tests.mjs'],{env:{...process.env,GPS_AUTHORITY_TEST_CONTAINER:container},stdio:'inherit',timeout:60000});
 execFileSync(process.execPath,['scripts/verified-visit-completion-integration-tests.mjs'],{env:{...process.env,VERIFIED_VISIT_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 assert.equal(sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',migrationCount:hashes.length,migrationHead:hashes.at(-1),automaticGrantsAbsent:true,production:false,physical:false}));
}finally{cleanup();}
