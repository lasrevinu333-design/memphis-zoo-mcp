import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,mkdtempSync,chmodSync,rmdirSync,unlinkSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet,loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {assertCurrentManager219MigrationSet} from './fixtures/current-manager-219-source.mjs';
import {createRecurringClockRecorder,runRecurringClockedChild} from './static-weekly-recurring-http-boundary.mjs';
import {ORDERED_PSQL_SHELL,orderedSqlBatch,orderedPsqlFrames,parseOrderedPsqlReceipt,
 DEFAULT_GRANTS_QUERY,REMOVE_DEFAULT_GRANTS_SQL,ABSENCE_GUARD,RESTORE_DEFAULT_GRANTS_FILES}
 from './static-weekly-ordered-psql-transport.mjs';
const container=`mz_schema_shift_end_${process.pid}`;
const stage=process.argv[2]??'all';
assert.ok(['all','migration-only','separation-context-only','atomic-only','published-only','current-roster-only','current-manager-216','current-manager-217','current-manager-218','current-manager-219','current-manager-owned-219','dual-source-217','dual-source-218','dual-source-219','recurring-ledger-only','recurring-parent-only','recurring-source-only','recurring-dependency-only','recurring-binding-shape-only','recurring-terminal-boundary-only','recurring-lock-order-only','recurring-generation-only','legacy-only','activation-only','legacy-observation-only'].includes(stage),'explicit bounded test stage');
const ownedManager219Stage=stage==='current-manager-owned-219';
const currentManager216Stage=stage==='current-manager-216';
const currentManager217Stage=stage==='current-manager-217';
const currentManager218Stage=stage==='current-manager-218';
const currentManager219Stage=stage==='current-manager-219'||ownedManager219Stage;
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
const socketStage=publishedStage||ownedManager219Stage||dualSource217Stage||dualSource218Stage||dualSource219Stage||['recurring-ledger-only','recurring-parent-only','recurring-source-only','recurring-dependency-only','recurring-binding-shape-only','recurring-terminal-boundary-only','recurring-lock-order-only','recurring-generation-only'].includes(stage);
const recurringSourceStage=['recurring-ledger-only','recurring-parent-only','recurring-source-only'].includes(stage);
if(recurringSourceStage){
 assert.ok(process.env.STATIC_WEEKLY_TEST_SIX_PACKET,'explicit preserved source fixture required before database startup');
 assert.ok(readFileSync(process.env.STATIC_WEEKLY_TEST_SIX_PACKET).length,'preserved source fixture must be readable');
}
let socket=null;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>{
 const remaining=50_000-performance.now();
 if(ownedManager219Stage&&remaining<1)throw new Error('Owned current219 work deadline elapsed before Docker/SQL operation');
 return execFileSync('docker',args,{encoding:'utf8',timeout:120000,
  maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra,
  ...(ownedManager219Stage?{timeout:Math.floor(Math.min(remaining,extra.timeout??120000))}:{})});
};
const dockerCleanup=(args)=>{
 const remaining=60_000-performance.now();
 if(ownedManager219Stage&&remaining<1)throw new Error('Owned current219 cleanup deadline elapsed; exact container absence unproven');
 return execFileSync('docker',args,{encoding:'utf8',
  timeout:ownedManager219Stage?Math.floor(Math.min(5000,remaining)):120000,
  maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
};
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text}).trim();
const defaults=DEFAULT_GRANTS_QUERY,removeDefaultsSql=REMOVE_DEFAULT_GRANTS_SQL,absenceGuard=ABSENCE_GUARD;
let owned=false;const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
let finalStageReceipt=null;
assert.equal(files.length,currentManager219Stage||dualSource219Stage?219:currentManager218Stage||dualSource218Stage?218:
 currentManager217Stage||dualSource217Stage?217:currentManager216Stage?216:176,'exact stage-specific migration set');
assert.equal(files.at(-1),currentManager219Stage||dualSource219Stage||currentManager218Stage||dualSource218Stage?'20261004000000_native_provider_event_decision_lookup.sql':
 currentManager217Stage||dualSource217Stage?'20261003230000_static_weekly_named_handoff_derivation.sql':
 currentManager216Stage?'20261003220000_current_release_authority_completion.sql':
 '20260929125440_custodial_recovery_inventory_closure.sql','exact stage-specific migration head');
function cleanup(){if(owned){dockerCleanup(['stop','-t',ownedManager219Stage?'0':'10',container]);
 if(dockerCleanup(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim())dockerCleanup(['rm','-f',container]);
 owned=false;assert.equal(dockerCleanup(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}
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
 const readinessStarted=performance.now();let readinessAttempts=0;
 let ready=0;for(let n=0;n<60&&ready<4;n++){
  readinessAttempts++;
  // An unavailable database is ordinary during startup; an expired absolute
  // work clock is not. Never swallow that deadline as another readiness miss.
  if(ownedManager219Stage&&50_000-performance.now()<1)throw new Error('Owned current219 work deadline elapsed during readiness');
  try{sql('select 1');ready++;}catch(error){
   if(ownedManager219Stage&&50_000-performance.now()<1)throw error;
   ready=0;
  }
  if(ready<4){const wait=ownedManager219Stage?Math.min(500,Math.max(0,50_000-performance.now())):500;
   if(wait<1)throw new Error('Owned current219 work deadline elapsed during readiness');
   await new Promise(r=>setTimeout(r,wait));}
 }assert.equal(ready,4);
 if(ownedManager219Stage)console.log('OWNED_REPLAY_READINESS',JSON.stringify({attempts:readinessAttempts,
  durationMilliseconds:Math.round(performance.now()-readinessStarted),
  elapsedFromProcessOriginMilliseconds:Math.round(performance.now()),
  remainingWorkMilliseconds:Math.max(0,Math.floor(50_000-performance.now()))}));
 sql(removeDefaultsSql+absenceGuard);
 const orderedEntries=[];
 for(const file of files){
  const bytes=readFileSync('supabase/migrations/'+file);
  const restoresDefaults=RESTORE_DEFAULT_GRANTS_FILES.has(file);
  if(restoresDefaults)assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);
  // Same fail-closed before/after checks, in one bounded psql invocation per
  // file. Avoid hundreds of extra Docker connections on the mechanical disk.
  if(ownedManager219Stage)orderedEntries.push({file,
   batch:orderedSqlBatch({absenceGuard,bytes,restoreDefaultsSql:restoresDefaults?removeDefaultsSql:''})});
  else{
   try{sql(absenceGuard+'\n'+bytes+'\n'+(restoresDefaults?removeDefaultsSql:'')+'\n'+absenceGuard);}
   catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
   manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
   if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
  }
 }
 if(ownedManager219Stage){
  const frames=orderedPsqlFrames(orderedEntries);
  const remainingAtChannelCall=Math.max(0,Math.floor(50_000-performance.now()));
  let protocol;
  try{
   const output=docker(['exec','-i',container,'sh','-c',ORDERED_PSQL_SHELL,'replay',String(orderedEntries.length)],{input:frames.input});
   protocol=parseOrderedPsqlReceipt(output,orderedEntries);
  }catch(error){
   let partial=null;
   try{partial=parseOrderedPsqlReceipt(String(error.stdout??''),orderedEntries,{allowFailure:true});}catch{}
   const index=partial?.failed?.index??partial?.incomplete?.index??(partial&&partial.completed<files.length?partial.completed:null);
   console.error('ORDERED_REPLAY_FAILURE',JSON.stringify({file:index==null?null:files[index],
    completed:partial?.completed??0,code:partial?.failed?.code??error.code??'UNPROVEN',
    remainingAtChannelCall,remainingAfterFailureMilliseconds:Math.max(0,Math.floor(50_000-performance.now())),
    truncatedProtocolLine:partial?.truncatedProtocolLine??false,
    envelopes:(partial?.envelopes??[]).map(row=>({...row,
     remainingUpperBoundMilliseconds:row.endTick===null?null:Math.max(0,remainingAtChannelCall-row.cumulativeSinceChannelReadyMilliseconds)})),
    measurement:partial?.measurement??'no valid bounded receipt'}));
   throw error;
  }
  assert.equal(protocol.completed,files.length);
  console.log('ORDERED_REPLAY_TIMING',JSON.stringify({...protocol,
   envelopes:protocol.envelopes.map(row=>({...row,
    remainingUpperBoundMilliseconds:Math.max(0,remainingAtChannelCall-row.cumulativeSinceChannelReadyMilliseconds)})),
   remainingAtChannelCall,
   remainingAfterChannelMilliseconds:Math.max(0,Math.floor(50_000-performance.now())),
   remainingPerFrameIsNotExact:'container monotonic ticks exclude Docker exec startup; only parent before/after remaining are authoritative'}));
  for(const file of files){const bytes=readFileSync('supabase/migrations/'+file);
   manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});}
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 if(ownedManager219Stage){
  const exact=JSON.parse(docker(['inspect',container]))[0];
  assert.match(exact.Id,/^[a-f0-9]{64}$/);
  assert.equal(exact.HostConfig.NetworkMode,'none');
  assert.ok(exact.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
  const {runCurrentManagerOwned219Stage}=await import('./static-weekly-current-manager-owned-stage.mjs');
  const receipt=await runCurrentManagerOwned219Stage({container,socket,containerId:exact.Id,docker,sql});
  assert.equal(receipt.status,'PASS');
  finalStageReceipt=receipt;
 }
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
 const publishedChildClock=currentManagerStage?createRecurringClockRecorder({deadlineMilliseconds:60000,
  emit:fact=>writeSync(1,`CURRENT_MANAGER_PUBLISHED_CHILD_CLOCK ${JSON.stringify(fact)}\n`)}):null;
 if(publishedStage)runRecurringClockedChild(()=>execFileSync(process.execPath,[stage==='current-roster-only'||currentManagerStage?'scripts/static-weekly-current-roster-publication-tests.mjs':'scripts/static-weekly-published-roster-transaction-tests.mjs'],{
  // The entire diagnostic/acceptance child has one absolute one-minute bound.
  // A later stage or retry never renews it; timeout is failure, not receipt.
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   ...(currentManager218Browser?{CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID:String(process.pid)}:{}),
   ...(currentManager216Stage?{STATIC_WEEKLY_TEST_CURRENT_216:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager217Stage?{STATIC_WEEKLY_TEST_CURRENT_217:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager218Stage?{STATIC_WEEKLY_TEST_CURRENT_218:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{}),
   ...(currentManager219Stage?{STATIC_WEEKLY_TEST_CURRENT_219:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{})},stdio:'inherit',
  timeout:60000}),publishedChildClock);
 if(dualSource217Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_217:'1'},stdio:'inherit',timeout:60000});
 if(dualSource218Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_218:'1'},stdio:'inherit',timeout:60000});
 if(dualSource219Stage)execFileSync(process.execPath,['scripts/static-weekly-dual-source-current-correction-sql-tests.mjs'],{
  env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
   STATIC_WEEKLY_TEST_DUAL_SOURCE_219:'1'},stdio:'inherit',timeout:60000});
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
}catch(error){console.error('FAILED_TEST_STAGE',stage,error.stderr?.toString()||error.stack);throw error;}finally{cleanup();}
if(ownedManager219Stage){
 assert.ok(performance.now()<60_000,'original process-start sixty seconds includes exact container/socket cleanup');
 assert.equal(finalStageReceipt?.status,'PASS','owned operation receipt required after cleanup');
 console.log('OWNED_CURRENT_MANAGER_219_RECEIPT',JSON.stringify(finalStageReceipt));
}
console.log(JSON.stringify({status:'PASS',stage,migrations:manifest,automatic_grants_absent_before_and_after_each:true,production:false,independent_audit:false}));
