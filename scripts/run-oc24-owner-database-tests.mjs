import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const mode=process.argv[2]||'completion';
assert.ok(['completion','coverall','analytics','rebuild-functional'].includes(mode));
const container=mode==='completion'?`mz_verified_visit_${process.pid}`:`mz_schema_rebuild_oc24_${process.pid}`;
let socketParent,socketDir;
if(mode==='coverall'){
 socketParent=mkdtempSync(path.join(tmpdir(),'custodial-oc24-pg-'));
 socketDir=path.join(socketParent,'socket');mkdirSync(socketDir);chmodSync(socketDir,0o777);
 console.log('OWNED_SOCKET',socketParent,'cleanup=exact directory in finally');
}
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text}).trim();
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace='public'::regnamespace and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])sql(`alter default privileges for role ${owner} in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges for role ${owner} in schema public revoke all on sequences from anon,authenticated,service_role;`);};
let owned=false;const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.length,150,'exact changed-input migration set');
assert.equal(files.at(-1),'20260925020244_oc24_bound_legacy_completion_replay.sql','exact changed-input migration head');
function cleanup(){if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}if(socketParent&&existsSync(socketParent)){rmSync(socketParent,{recursive:true});console.log('OWNED_SOCKET_REMOVED',socketParent);}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});

let historicalBefore,legacyCutover,checks=0;
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name)};
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const denied=(name,statement,pattern=/permission denied|recording is retired|CoverAll must be added manually/)=>{let failure;try{sql(statement)}catch(e){failure=e}assert.ok(failure,name);assert.match(String(failure.stderr),pattern,name);checks++;console.log('PASS',name)};
function seedHistoricalInspection(){
 sql(`insert into public.employees(id,employee_code,display_name,active,role) values('11111111-1111-4111-8111-111111111124','OC24_HISTORY','Synthetic historical employee',true,'staff');
 insert into public.locations(id,location_code,location_name,location_type,form_type,active) values('22222222-2222-4222-8222-222222222224','OC24_HISTORY','Synthetic history restroom','restroom','restroom',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
 values('55555555-5555-4555-8555-555555555524','OC24_HISTORY_DEVICE','Synthetic historical device',true,'11111111-1111-4111-8111-111111111124');
 insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes)
 values('33333333-3333-4333-8333-333333333324','33333333-3333-4333-8333-333333333324','22222222-2222-4222-8222-222222222224','11111111-1111-4111-8111-111111111124','55555555-5555-4555-8555-555555555524','closed',now()-interval '10 minutes',now()-interval '1 minute',9);
 insert into public.cleaning_inspections(operation_id,request_fingerprint,session_id,overall_score,inspector_name_snapshot)
 values('44444444-4444-4444-8444-444444444424',repeat('4',64),'33333333-3333-4333-8333-333333333324',90,'Synthetic historical observation');`);
 historicalBefore=sql("select to_jsonb(t)::text from public.cleaning_inspections t where operation_id='44444444-4444-4444-8444-444444444424'");
 check('historical inspection fixture exists before forward migration',Boolean(historicalBefore),true);
}
function runOwnerBoundaryProof(){
 const history=()=>sql("select to_jsonb(t)::text from public.cleaning_inspections t where operation_id='44444444-4444-4444-8444-444444444424'");
 check('forward migration preserves historical row bytes',history(),historicalBefore);
 const roles=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
 const fns=['custodial_oc24_completion_selection_guard()','custodial_oc24_inspection_recording_retired()','app_apply_coverall_assignment_policy_v2(jsonb)','custodial_oc24_service_trim(text)','custodial_oc24_assert_completion_selection(jsonb)','custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text)'];
 for(const role of roles){
  denied(role+' actual new inspection denied',`set role ${role}; insert into public.cleaning_inspections(overall_score) values(90)`);
  denied(role+' actual historical mutation denied',`set role ${role}; update public.cleaning_inspections set overall_score=95 where operation_id='44444444-4444-4444-8444-444444444424'`);
  denied(role+' automatic contractor RPC denied',`set role ${role};select public.app_apply_coverall_assignment_policy_v2('{}')`);
  denied(role+' actual trim helper denied',`set role ${role};select public.custodial_oc24_service_trim(' x ')`);
  denied(role+' actual selection helper denied',`set role ${role};select public.custodial_oc24_assert_completion_selection('{"work_result":"checked_no_cleaning_needed","services_performed":[]}'::jsonb)`);
  denied(role+' actual legacy helper denied',`set role ${role};select public.custodial_oc24_legacy_replay_allowed('','','','','','','','{}','[]','')`);
  for(const f of fns)check(role+' no helper execute '+f,sql(`select has_function_privilege('${role}','public.${f}','EXECUTE')`),'f');
 }
 check('existing service-role historical read preserved',sql("set role service_role;select count(*) from public.cleaning_inspections where operation_id='44444444-4444-4444-8444-444444444424'"),'1');
 denied('table owner cannot create new inspection',"insert into public.cleaning_inspections(overall_score) values(90)",/recording is retired/);
 denied('table owner cannot edit old inspection',"update public.cleaning_inspections set overall_score=90",/recording is retired/);
 for(const response of [
  {},{services_performed:['Floor']},{services_performed:[]},{services_performed:['Full cleaning services','Floor']},
  {services_performed:['Floor'],legacy:true,created_at:'2020-01-01',schema_version:1},
  {work_result:'full',services_performed:['Full cleaning services','Sweep the floor']},
  {work_result:'full',services_performed:['Sweep the floor']},
  {work_result:'details',services_performed:[' full CLEANING services ']},
  {work_result:'details',services_performed:[]},
  {work_result:'checked_no_cleaning_needed',services_performed:['Sweep the floor']},
  {work_result:'invented',services_performed:[]},
 ]){
  denied('actual completion table rejects '+JSON.stringify(response),`insert into public.completion_responses(response_json) values(${q(JSON.stringify(response))}::jsonb)`,/full cleaning|selective cleaning|check-only|unsupported completion|explicit work_result/);
 }
 // Exact trigger/function/grant drift and replay in the disposable database only.
 const whitespace=[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279];
 for(const code of whitespace){
  const ws=String.fromCodePoint(code);
  check('SQL normalization agrees with JS trim U+'+code.toString(16),sql(`select public.custodial_oc24_service_trim(${q(ws+'word'+ws)})`),(ws+'word'+ws).trim());
  for(const services of [[ws],[ws+'Full cleaning services'+ws],[ws+'Full cleaning services'+ws,'Sweep the floor']]){
   denied('table rejects selective whitespace/full alias U+'+code.toString(16),`insert into public.completion_responses(response_json) values(${q(JSON.stringify({work_result:'details',services_performed:services}))}::jsonb)`,/selective cleaning/);
  }
 }
 for(const code of [0x85,0x180e,0x200b])check('non-JS whitespace preserved U+'+code.toString(16),sql(`select public.custodial_oc24_service_trim(${q(String.fromCodePoint(code)+'word'+String.fromCodePoint(code))})`),String.fromCodePoint(code)+'word'+String.fromCodePoint(code));
 const identities=['public.completion_responses.trg_oc24_completion_selection','public.cleaning_inspections.aaa_oc24_inspection_recording_retired'];
 check('both new trigger definitions retained',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity in (${identities.map(q).join(',')})`),'2');
 const definitions=JSON.parse(sql(`select json_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where (object_kind='trigger' and object_identity in (${identities.map(q).join(',')})) or (object_kind in ('function','grant') and (object_identity like '%custodial_oc24_%' or object_identity like '%app_apply_coverall_assignment_policy_v2(%' or object_identity='public.cleaning_inspections'))`));
 assert.ok(definitions.some(d=>d.includes('enable always')));
 sql("drop trigger trg_oc24_completion_selection on public.completion_responses; drop trigger aaa_oc24_inspection_recording_retired on public.cleaning_inspections; grant insert on public.cleaning_inspections to service_role; grant execute on function public.app_apply_coverall_assignment_policy_v2(jsonb) to service_role; create or replace function public.custodial_oc24_service_trim(p_value text) returns text language sql immutable strict parallel safe set search_path=pg_catalog as 'select p_value'; grant execute on function public.custodial_oc24_service_trim(text) to authenticated;");
 // pg_get_functiondef is executable independently, not a semicolon-delimited
 // script. Match the production inventory's per-object execution boundary.
 for(const definition of definitions)sql(definition);
 check('recovered trigger enforcement state',sql("select count(*) from pg_trigger where tgname in ('trg_oc24_completion_selection','aaa_oc24_inspection_recording_retired') and tgenabled='A'"),'2');
 check('recovered inspection write grant',sql("select has_table_privilege('service_role','public.cleaning_inspections','INSERT')"),'f');
 denied('recovered table trigger rejects recording',"insert into public.cleaning_inspections(overall_score) values(90)",/recording is retired/);
 denied('recovered contractor RPC denied',"set role service_role;select public.app_apply_coverall_assignment_policy_v2('{}')");
 check('recovery preserves exact historical row',history(),historicalBefore);
 const legacyBytes=()=>sql(`select to_jsonb(cr)::text from public.completion_responses cr where client_completion_id=${q(legacyCutover.visit.completion)}`);
 check('legacy completion historical bytes unchanged',legacyBytes(),legacyCutover.bytes);
 for(let n=0;n<2;n++){
  const replay=JSON.parse(sql(legacyCutover.statement));check('exact accepted legacy replay '+n,replay.replayed,true);
  check('same original legacy session '+n,replay.session_uuid,legacyCutover.accepted.session_uuid);
 }
 denied('fresh missing outcome rejected',legacyCutover.freshStatement,/explicit work_result/);
 denied('forged client legacy rejected',legacyCutover.forgedStatement,/explicit work_result/);
 denied('changed legacy answers rejected',legacyCutover.tamperedStatement,/explicit work_result/);
 check('legacy completion remains unique',sql(`select count(*) from public.completion_responses where client_completion_id=${q(legacyCutover.visit.completion)}`),'1');
 check('replay/rejection preserves historical bytes',legacyBytes(),legacyCutover.bytes);
 check('rejected missing outcome cannot advance dashboard cleaned time',sql(`select public.custodial_canonical_utc_millis(latest_completed_at) from public.v_location_dashboard_status where location_id=${q(legacyCutover.location)}`),legacyCutover.dashboard.cleaned);
 check('exact trim implementation recovered',sql("select public.custodial_oc24_service_trim(chr(9)||'Full cleaning services'||chr(160))"),'Full cleaning services');
 denied('recovered trim denied to runtime caller',"set role authenticated; select public.custodial_oc24_service_trim(' x ')");
 denied('recovered table blocks whitespace alias',`insert into public.completion_responses(response_json) values(${q(JSON.stringify({work_result:'details',services_performed:['\tFull cleaning services\t']}))}::jsonb)`,/selective cleaning/);
 console.log(JSON.stringify({oc24DatabaseChecks:checks,production:false,independentAudit:false}));
}

try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  ...(socketDir?['--mount',`type=bind,src=${socketDir},dst=/audit-pg-socket`]:[]),
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
  ...(socketDir?['-c','unix_socket_directories=/var/run/postgresql,/audit-pg-socket']:[])]);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
 removeDefaults();
 for(const file of files){
  assert.equal(sql(defaults),'0','before '+file);const bytes=readFileSync('supabase/migrations/'+file);
  if(mode==='completion'&&file.startsWith('20260924161004_')) seedHistoricalInspection();
  if(mode==='completion'&&file.startsWith('20260925020244_')){
   legacyCutover=JSON.parse(execFileSync(process.execPath,['scripts/verified-visit-completion-integration-tests.mjs','--seed-pre-cutover-legacy'],{env:{...process.env,VERIFIED_VISIT_TEST_CONTAINER:container},encoding:'utf8',timeout:30000}));
   check('real pre-cutover canonical acceptance captured',legacyCutover.accepted.status,'closed');
  }
  try{sql(bytes);}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  if(Number(sql(defaults))){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();
  }
  assert.equal(sql(defaults),'0','after '+file);manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 if(mode==='completion'){
  runOwnerBoundaryProof();
  execFileSync(process.execPath,['scripts/verified-visit-completion-integration-tests.mjs'],{env:{...process.env,VERIFIED_VISIT_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 }else if(mode==='coverall'){
  const {coverallPrintDatabaseProof}=await import('./fixtures/oc24-coverall-database-fixture.mjs');
  await coverallPrintDatabaseProof({sql,container,socketDir});
  sql("insert into public.employees(id,employee_code,display_name,active,role) values('00000000-0000-4000-8000-00000000e099','COVERALL_01','Synthetic manual capacity',true,'staff') on conflict(employee_code) do nothing;");
  execFileSync(process.execPath,['scripts/custodial-coverage-policy-database-tests.mjs'],{env:{...process.env,CUSTODIAL_COVERAGE_POLICY_TEST_DOCKER_CONTAINER:container},stdio:'inherit',timeout:120000});
 }else if(mode==='rebuild-functional'){
  // Focused changed-fixture proof only. The normal rebuild command retains its
  // canonical fingerprint gate; this subset is never reported as that gate.
  const rebuildSource=readFileSync('scripts/empty-database-rebuild-check.mjs','utf8');
  const matches=[...rebuildSource.matchAll(/const exactFinishFunctionalSql = `([\s\S]*?)`;/g)];
  assert.equal(matches.length,1,'one exact existing functional SQL fixture');
  assert.ok(!matches[0][1].includes('${'),'fixture must not need interpolation');
  sql(matches[0][1]);
  console.log('REBUILD_FUNCTIONAL_FIXTURE_SUBSET_PASS; canonical fingerprint/full rebuild NOT RUN');
 }else{
  execFileSync(process.execPath,['scripts/operational-analytics-database-tests.mjs','--oc24-work-stats-only'],{env:{...process.env,OPERATIONAL_ANALYTICS_TEST_DOCKER_CONTAINER:container},stdio:'inherit',timeout:120000});
 }
 assert.equal(sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',migrations:manifest,automatic_grants_absent_before_and_after_each:true,production:false,independent_audit:false}));
}finally{cleanup();}
