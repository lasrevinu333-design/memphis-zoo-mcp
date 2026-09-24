import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,mkdtempSync,chmodSync,rmdirSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
const container=`mz_schema_shift_end_${process.pid}`;
const stage=process.argv[2]??'all';
assert.ok(['all','atomic-only','published-only','current-roster-only','legacy-only','activation-only','legacy-activation-only','legacy-observation-only'].includes(stage),'explicit bounded test stage');
const publishedStage=['published-only','current-roster-only'].includes(stage);
let socket=null;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text}).trim();
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaultsSql=['postgres','supabase_admin'].map(owner=>`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`).join('\n');
const absenceGuard=`do $absence$begin if (${defaults})<>0 then raise exception 'automatic Data API table/sequence grants must be absent'; end if;end$absence$;`;
let owned=false;const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.length,145,'exact current changed-input migration set');
function cleanup(){if(owned){docker(['stop','-t','10',container]);
 if(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim())docker(['rm','-f',container]);
 owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}
 if(socket){for(const file of readdirSync(socket)){assert.ok(['.s.PGSQL.5432','.s.PGSQL.5432.lock'].includes(file),'only owned PostgreSQL socket remnants');unlinkSync(socket+'/'+file);}
 rmdirSync(socket);console.log('OWNED_SOCKET_DIRECTORY_REMOVED',socket);socket=null;}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 if(publishedStage){socket=mkdtempSync('/tmp/mz-shift-socket-');chmodSync(socket,0o777);console.log('OWNED_SOCKET_DIRECTORY',socket,'cleanup: empty directory after exact container removal');}
 docker(['run','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  ...(socket?['--mount',`type=bind,source=${socket},destination=/test-socket`]:[]),
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
  ...(socket?['-c','unix_socket_directories=/var/run/postgresql,/test-socket']:[])]);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
 sql(removeDefaultsSql+absenceGuard);
 for(const file of files){
  const bytes=readFileSync('supabase/migrations/'+file);
  const restoresDefaults=['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file);
  if(restoresDefaults)assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);
  // Same fail-closed before/after checks, in one bounded psql invocation per
  // file. Avoid hundreds of extra Docker connections on the mechanical disk.
  try{sql(absenceGuard+'\n'+bytes+'\n'+(restoresDefaults?removeDefaultsSql:'')+'\n'+absenceGuard);}
  catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 if(stage==='all')execFileSync(process.execPath,['scripts/static-weekly-shift-end-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:420000});
 if(['all','atomic-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-atomic-roster-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 if(publishedStage)execFileSync(process.execPath,[stage==='current-roster-only'?'scripts/static-weekly-current-roster-publication-tests.mjs':'scripts/static-weekly-published-roster-transaction-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:900000});
 if(stage==='legacy-only'){
  execFileSync(process.execPath,['scripts/static-weekly-vacant-roster-slot-database-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:120000});
  execFileSync(process.execPath,['scripts/static-weekly-vacate-roster-slot-fixture-tests.mjs'],{
   env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:container},stdio:'inherit',timeout:240000});
 }
 if(stage==='activation-only')execFileSync(process.execPath,['scripts/assigned-activation-transport-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 if(stage==='legacy-activation-only')for(const script of ['assigned-activation-transport-database-tests.mjs','legacy-activation-database-tests.mjs'])
  execFileSync(process.execPath,['scripts/'+script],{env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:240000});
 if(stage==='legacy-observation-only')execFileSync(process.execPath,['scripts/legacy-activation-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:240000});
 assert.equal(sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',stage,migrations:manifest,automatic_grants_absent_before_and_after_each:true,production:false,independent_audit:false}));
}catch(error){console.error('FAILED_TEST_STAGE',stage,error.stderr?.toString()||error.stack);throw error;}finally{cleanup();}
