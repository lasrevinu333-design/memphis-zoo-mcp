import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,mkdtempSync,chmodSync,rmdirSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet,loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {assertCurrentManager219MigrationSet} from './fixtures/current-manager-219-source.mjs';
const container=`mz_schema_shift_end_${process.pid}`;
const stage=process.argv[2]??'all';
assert.ok(['all','migration-only','separation-context-only','atomic-only','published-only','current-roster-only','current-manager-216','current-manager-217','current-manager-218','current-manager-219','dual-source-217','dual-source-218','dual-source-219','recurring-ledger-only','recurring-parent-only','recurring-source-only','recurring-dependency-only','recurring-binding-shape-only','recurring-terminal-boundary-only','recurring-lock-order-only','recurring-generation-only','legacy-only','activation-only','legacy-observation-only'].includes(stage),'explicit bounded test stage');
const currentManager216Stage=stage==='current-manager-216';
const currentManager217Stage=stage==='current-manager-217';
const currentManager218Stage=stage==='current-manager-218';
const currentManager219Stage=stage==='current-manager-219';
const currentManager218Http=process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP==='1';
const currentManager218Browser=process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER==='1';
assert.ok(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP==null||currentManager218Http,
 'recurring HTTP SQL variant accepts only explicit 1');
assert.ok(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER==null||currentManager218Browser,
 'recurring browser SQL variant accepts only explicit 1');
assert.ok(!currentManager218Http||currentManager218Stage||currentManager219Stage,
 'authenticated HTTP SQL confirmation variant belongs only to exact current-manager-218 or current-manager-219');
assert.ok(!currentManager218Browser||currentManager218Stage||currentManager219Stage,
 'authenticated browser SQL confirmation variant belongs only to exact current-manager-218 or current-manager-219');
assert.ok(!(currentManager218Http&&currentManager218Browser),'only one authenticated HTTP confirmation transport');
if(currentManager218Browser){
 assert.ok(Number(process.env.CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID)===process.ppid,
  'browser stage must be direct child of live guarded lease driver');
 assert.ok(process.env.CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR,
  'browser stage requires caller-owned private evidence directory');
}
const dualSource217Stage=stage==='dual-source-217';
const dualSource218Stage=stage==='dual-source-218';
const dualSource219Stage=stage==='dual-source-219';
const currentManagerStage=currentManager216Stage||currentManager217Stage||currentManager218Stage||currentManager219Stage;
const publishedStage=['published-only','current-roster-only','current-manager-216','current-manager-217','current-manager-218','current-manager-219'].includes(stage);
if(currentManager216Stage){assertCurrentManagerMigrationSet();loadCurrentManagerPublicationFixture();}
if(currentManager217Stage){assertCurrentManager217MigrationSet();loadCurrentManagerPublicationFixture();}
if(dualSource217Stage){assertCurrentManager217MigrationSet();loadCurrentManagerPublicationFixture();}
if(currentManager218Stage){assertCurrentManager218MigrationSet();loadCurrentManagerPublicationFixture();}
if(currentManager219Stage){assertCurrentManager219MigrationSet();loadCurrentManagerPublicationFixture();}
if(dualSource218Stage){assertCurrentManager218MigrationSet();loadCurrentManagerPublicationFixture();}
if(dualSource219Stage){assertCurrentManager219MigrationSet();loadCurrentManagerPublicationFixture();}
const socketStage=publishedStage||dualSource217Stage||dualSource218Stage||dualSource219Stage||['recurring-ledger-only','recurring-parent-only','recurring-source-only','recurring-dependency-only','recurring-binding-shape-only','recurring-terminal-boundary-only','recurring-lock-order-only','recurring-generation-only'].includes(stage);
const recurringSourceStage=['recurring-ledger-only','recurring-parent-only','recurring-source-only'].includes(stage);
if(recurringSourceStage){
 assert.ok(process.env.STATIC_WEEKLY_TEST_SIX_PACKET,'explicit preserved source fixture required before database startup');
 assert.ok(readFileSync(process.env.STATIC_WEEKLY_TEST_SIX_PACKET).length,'preserved source fixture must be readable');
}
let socket=null;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text}).trim();
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaultsSql=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].map(scope=>`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)).join('\n');
const absenceGuard=`do $absence$begin if (${defaults})<>0 then raise exception 'automatic Data API table/sequence grants must be absent'; end if;end$absence$;`;
let owned=false;const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.length,currentManager219Stage||dualSource219Stage?219:currentManager218Stage||dualSource218Stage?218:
 currentManager217Stage||dualSource217Stage?217:currentManager216Stage?216:176,'exact stage-specific migration set');
assert.equal(files.at(-1),currentManager219Stage||dualSource219Stage||currentManager218Stage||dualSource218Stage?'20261004000000_native_provider_event_decision_lookup.sql':
 currentManager217Stage||dualSource217Stage?'20261003230000_static_weekly_named_handoff_derivation.sql':
 currentManager216Stage?'20261003220000_current_release_authority_completion.sql':
 '20260929125440_custodial_recovery_inventory_closure.sql','exact stage-specific migration head');
function cleanup(){if(owned){docker(['stop','-t','10',container]);
 if(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim())docker(['rm','-f',container]);
 owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}
 if(socket){for(const file of readdirSync(socket)){assert.ok(['.s.PGSQL.5432','.s.PGSQL.5432.lock'].includes(file),'only owned PostgreSQL socket remnants');unlinkSync(socket+'/'+file);}
 rmdirSync(socket);console.log('OWNED_SOCKET_DIRECTORY_REMOVED',socket);socket=null;}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);
 if(socketStage){socket=mkdtempSync('/tmp/mz-shift-socket-');chmodSync(socket,0o777);console.log('OWNED_SOCKET_DIRECTORY',socket,'cleanup: empty directory after exact container removal');}
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
 if(process.env.STATIC_WEEKLY_TEST_REMINDER_PROJECTION==='1'){
  sql("begin read only;set local role custodial_application_reader;select count(*) from public.v_location_dashboard_status;select count(*) from public.mz_location_reminder_candidates(current_date,now());rollback;");
  console.log('ACTUAL_DEDICATED_READER_EMPTY_SCHEMA_PREFLIGHT_PASS');
 }
 if(['recurring-ledger-only','recurring-parent-only'].includes(stage)){
  // Challenge the detector, including PostgreSQL PUBLIC and global defaults.
  for(const scope of ['',' in schema public'])for(const kind of ['tables','sequences']){
   sql(`alter default privileges for role supabase_admin${scope} grant select on ${kind} to public;`);
   assert.ok(Number(sql(defaults))>0,'global/schema PUBLIC automatic grant is detected');
   sql(removeDefaultsSql+absenceGuard);
  }
  execFileSync(process.execPath,['scripts/static-weekly-recurring-ledger-database-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 }
 if(recurringSourceStage)execFileSync(process.execPath,['scripts/static-weekly-recurring-source-database-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 if(['recurring-ledger-only','recurring-generation-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-recurring-generation-database-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 if(['recurring-ledger-only','recurring-dependency-only'].includes(stage)){
  execFileSync(process.execPath,['scripts/static-weekly-recurring-dependency-database-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
  execFileSync(process.execPath,['scripts/static-weekly-recurring-range-selector-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 }
 if(['recurring-ledger-only','recurring-binding-shape-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-recurring-display-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 if(['recurring-ledger-only','recurring-terminal-boundary-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-recurring-terminal-boundary-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 if(['recurring-ledger-only','recurring-lock-order-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-recurring-lock-order-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket},stdio:'inherit',timeout:120000});
 if(stage==='all')execFileSync(process.execPath,['scripts/static-weekly-shift-end-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:420000});
 if(['all','atomic-only'].includes(stage))execFileSync(process.execPath,['scripts/static-weekly-atomic-roster-database-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 if(publishedStage)execFileSync(process.execPath,[stage==='current-roster-only'||currentManagerStage?'scripts/static-weekly-current-roster-publication-tests.mjs':'scripts/static-weekly-published-roster-transaction-tests.mjs'],{
  // Finalization adds a real projection plus three independent acceptance
  // attempts (two injected failures). Keep each production SQL/compiler
  // deadline unchanged; bound the expanded aggregate test at twenty minutes.
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   ...(currentManager218Browser?{CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID:String(process.pid)}:{}),
   ...(currentManager216Stage?{STATIC_WEEKLY_TEST_CURRENT_216:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager217Stage?{STATIC_WEEKLY_TEST_CURRENT_217:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager218Stage?{STATIC_WEEKLY_TEST_CURRENT_218:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager219Stage?{STATIC_WEEKLY_TEST_CURRENT_219:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{})},stdio:'inherit',
  timeout:currentManagerStage||process.env.STATIC_WEEKLY_TEST_RECURRING_FINALIZATION==='1'||process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION==='1'?1200000:900000});
 if(dualSource217Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_217:'1'},stdio:'inherit',timeout:1200000});
 if(dualSource218Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_218:'1'},stdio:'inherit',timeout:1200000});
 if(dualSource219Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_219:'1'},stdio:'inherit',timeout:1200000});
 if(stage==='separation-context-only')execFileSync(process.execPath,['scripts/static-weekly-vacate-roster-slot-fixture-tests.mjs'],{
  env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:container,SEPARATION_CONTEXT_PROOF:'1'},stdio:'inherit',timeout:240000});
 if(stage==='legacy-only'){
  execFileSync(process.execPath,['scripts/static-weekly-internal-employee-rpc-tests.mjs'],{
   env:{...process.env,SHIFT_END_TEST_CONTAINER:container},stdio:'inherit',timeout:120000});
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
