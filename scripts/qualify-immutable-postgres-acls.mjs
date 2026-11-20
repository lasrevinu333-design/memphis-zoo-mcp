// Opt-in SELECT-only native predicate qualification. No archive, credentials,
// application schema/DATA, grants, roles or existing databases are consumed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {types} from 'node:util';
import {PG_IMAGE,assertOwnedPg} from './run-private-backup-only-rehearsal.mjs';
import {loadImmutableCurrentPostgresSource} from './immutable-private-postgres-source.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const expectedCases=new WeakMap(),expectedOutcomes=new WeakMap(),expectedBatches=new WeakMap();
const casePrefixes=['DEVICE','MANAGER','EMPLOYEE_PUSH'];
const names=['immutable-original-device-boundary-restore.sql','immutable-original-manager-push-restore.sql','immutable-original-employee-push-authority-restore.sql'];
const predicate=sql=>{
 const start=sql.indexOf("IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,"),end=sql.indexOf('THEN RAISE EXCEPTION',start);
 assert.ok(start>=0&&end>start);return sql.slice(start+3,end).trim();
};
export function immutablePostgresAclFixtureSql(){
 assert.equal(arguments.length,0);
 const program=loadImmutableCurrentPostgresSource(),queries=[],expectedErrors=[];
 const cases=[
  ['owner','{postgres=X/postgres}',true],['missing','{postgres=/postgres}',false],['null',null,false],
  ['wrong_principal','{pg_monitor=X/postgres}',false],['public','{postgres=X/postgres,=X/postgres}',false],
  ['extra_principal','{postgres=X/postgres,pg_monitor=X/postgres}',false],
  ['wrong_grantor','{postgres=X/pg_monitor}',false],['grant_option','{postgres=X*/postgres}',false],
  ['wrong_privilege','{postgres=r/postgres}',false],['duplicate_owner','{postgres=X/postgres,postgres=X/postgres}',false],
  ['missing_owner','{=X/postgres}',false],
 ];
 for(const [index,name] of names.entries()){
  const statement=program.statements.find(s=>s.sourcePath==='proposals/'+name),current=statement.sql;
  const legacy=readFileSync(new URL('../proposals/'+name,import.meta.url),'utf8');
  assert.equal(sha(legacy),statement.originalSourceSha256);
  // PostgreSQL check_acl rejects the zero-dimensional empty array with22023.
  // Preserve that negative test separately, not as a Boolean aggregate row.
  for(const [variant,sql,sourceSha] of [['CURRENT',current,statement.sourceSha256],['LEGACY',legacy,statement.originalSourceSha256]]){
   const query=`begin read only;set local search_path=pg_catalog;set local statement_timeout='10s';\nselect (not (${predicate(sql)})) is not distinct from false ok from
    (select '{}'::aclitem[] proacl) original cross join
    (select 'postgres'::regrole::oid owner_oid,'postgres'::regrole::oid postgres_oid) owners;\nrollback;\n`;
   const item=Object.freeze({case_id:casePrefixes[index]+'_'+variant+'_EMPTY_ACL',source_sha256:sourceSha,sql_sha256:sha(query),sql:query});
   expectedCases.set(item,Object.freeze({...item}));expectedErrors.push(item);
  }
  for(const [label,acl,expected] of cases)for(const [sql,want] of [[current,expected],[legacy,label==='duplicate_owner']]){
   const value=acl===null?'null::aclitem[]':"'"+acl+"'::aclitem[]";
   queries.push(`select (not (${predicate(sql)})) is not distinct from ${want} ok from
    (select ${value} proacl) original cross join
    (select 'postgres'::regrole::oid owner_oid,'postgres'::regrole::oid postgres_oid) owners`);
  }
 }
 // Exact installed function-export SELECT, evaluated with synthetic catalog
 // ACL rows. No function/schema is installed and no ACL is changed.
 const exporter=readFileSync(new URL('../supabase/migrations/20260825174500_rebind_application_reader_release_recovery.sql',import.meta.url),'utf8');
 const start=exporter.indexOf("select 'select public.custodial_release_authority_reset_grants('" ,exporter.indexOf('if v_function is not null then'));
 const end=exporter.indexOf('    );',start);assert.ok(start>0&&end>start);
 const expression=exporter.slice(start,end).trim();
 assert.ok(expression.includes("a.grantee<>p.proowner"));
 const expected="select public.custodial_release_authority_reset_grants('pg_catalog.abs(integer)');";
 for(const [acl,passes] of [['{postgres=X/postgres}',true],['{postgres=X/postgres,=X/postgres}',false],['{postgres=X/postgres,pg_monitor=X/postgres}',false]]){
  queries.push(`select ((${expression}) = '${expected.replaceAll("'","''")}') is not distinct from ${passes} ok from
    (select 'pg_catalog.abs(integer)'::text p_object_identity,'pg_catalog.abs(integer)'::regprocedure::oid v_function) args` // catalog shadow is CTE only
    .replace('from pg_proc p',`from (select 'pg_catalog.abs(integer)'::regprocedure::oid oid,'postgres'::regrole::oid proowner,'${acl}'::aclitem[] proacl) p`));
 }
 program.assertCurrent();
 const sql=`begin read only;set local search_path=pg_catalog;set local statement_timeout='10s';\nselect json_build_object('checks',count(*),'passed',count(*) filter(where ok and current_user=session_user and current_user='postgres'),'failed',count(*) filter(where not ok or current_user<>session_user or current_user<>'postgres')) from (${queries.join('\nUNION ALL\n')}) checks;\nrollback;\n`;
 const batch={schema:'custodial.synthetic-owner-acl-batch.v1',boolean_checks:queries.length,boolean_sql_sha256:sha(sql),
  expected_errors:expectedErrors.map(({case_id,source_sha256,sql_sha256})=>({case_id,source_sha256,sql_sha256}))};
 assert.equal(queries.length,69);assert.equal(expectedErrors.length,6);
 const fixture=Object.freeze({checks:queries.length,sql,expected_error_cases:Object.freeze(expectedErrors),total_checks:75,batch_sha256:sha(JSON.stringify(batch))});
 expectedBatches.set(fixture,fixture.expected_error_cases);return fixture;
}
const sqlStates=new Set(['08000','08001','08003','08004','08006','08P01','22004','22023','22P02','23514','25006','25P02','28000','28P01','42501','42601','42703','42704','42883','42P01','53200','53300','53400','54000','54001','55000','57014','57P01','57P02','57P03','XX000']);
const own=(value,key)=>{
 if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
 const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;
};
// Closed metadata only, never argv, SQL, error.message, stack or vendor text.
export function syntheticSubprocessDiagnostic(result,sqlStateOnly=false){
 const status=own(result,'status'),signal=own(result,'signal'),errorCode=own(own(result,'error'),'code');
 const bytes=key=>{const value=own(result,key);return typeof value==='string'?Buffer.from(value):Buffer.alloc(0);};
 const stdout=bytes('stdout'),stderr=bytes('stderr'),codes=new Set();
 if(sqlStateOnly===true&&stderr.length<=65536){
  for(const line of stderr.toString('utf8').split('\n')){
   // VERBOSITY=sqlstate emits only this fixed prefix and code. Libpq startup
   // errors may still contain prose; those lines are deliberately not parsed.
   const match=line.match(/^(?:psql:(?:<stdin>|-c):[0-9]{1,6}: )?(?:ERROR|FATAL|PANIC): {1,2}([A-Z0-9]{5})$/);
   if(match&&sqlStates.has(match[1]))codes.add(match[1]);
  }
 }
 return Object.freeze({exit_code:Number.isInteger(status)&&status>=0&&status<=255?status:null,
  signal:['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBUS'].includes(signal)?signal:null,
  timed_out:errorCode==='ETIMEDOUT',output_limit_exceeded:errorCode==='ENOBUFS',
  ...(['ENOENT','EACCES','ETIMEDOUT','ENOBUFS'].includes(errorCode)?{node_code:errorCode}:{}),
  stdout_bytes:stdout.length,stdout_sha256:sha(stdout),stderr_bytes:stderr.length,stderr_sha256:sha(stderr),
  ...(codes.size===1?{sql_state:[...codes][0]}:{}),private_payload_exported:false});
}
const stdinPsqlArgs=cid=>['exec','-i',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-v','SHOW_CONTEXT=never','-U','postgres','-d','postgres'];
export function assertExpectedAclInvocation(item,args,input,cid){
 const bound=expectedCases.get(item);assert.ok(bound,'Known original expected-error case required.');
 assert.match(cid,/^[0-9a-f]{64}$/);assert.deepEqual(args,stdinPsqlArgs(cid));
 assert.equal(input,bound.sql);assert.equal(sha(input),bound.sql_sha256);return true;
}
export function classifyExpectedAclRefusal(item,observation){
 const bound=expectedCases.get(item);
 if(!bound)return Object.freeze({accepted:false,classification:'EXPECTED_ACL_CASE_BINDING_REFUSED'});
 const binding={case_id:bound.case_id,source_sha256:bound.source_sha256,sql_sha256:bound.sql_sha256};
 if(!observation||types.isProxy(observation)||Object.getPrototypeOf(observation)!==Object.prototype
   ||Reflect.ownKeys(observation).length!==4
   ||Object.keys(binding).some(key=>own(observation,key)!==binding[key])||!Object.hasOwn(observation,'process'))
  return Object.freeze({accepted:false,classification:'EXPECTED_ACL_CASE_BINDING_REFUSED',...binding});
 const result=own(observation,'process'),diagnostic=syntheticSubprocessDiagnostic(result,true),stderr=own(result,'stderr');
 // Exactly one canonical ERROR record, not a generic projected code. Reject
 // extra/unknown/duplicate lines, success, spawn errors, signals and output.
 const accepted=own(result,'status')===3&&own(result,'signal')===null&&own(result,'error')==null
  &&own(result,'stdout')===''&&typeof stderr==='string'
  &&/^(?:psql:<stdin>:[1-9][0-9]{0,5}: )?ERROR: {1,2}22023(?:\r?\n)?(?![\s\S])/.test(stderr)
  &&diagnostic.sql_state==='22023'&&!diagnostic.timed_out&&!diagnostic.output_limit_exceeded;
 const outcome=Object.freeze({accepted,classification:accepted?'EXPECTED_EMPTY_ACL_PARAMETER_REFUSAL':'EXPECTED_ACL_ERROR_MISMATCH',...binding,process:diagnostic});
 expectedOutcomes.set(outcome,item);return outcome;
}
export function verifyExpectedAclBatch(fixture,outcomes){
 const items=expectedBatches.get(fixture);assert.ok(items&&items.length===6,'Known complete expected-error batch required.');
 assert.ok(Array.isArray(outcomes)&&!types.isProxy(outcomes)&&Object.getPrototypeOf(outcomes)===Array.prototype);
 assert.equal(own(outcomes,'length'),items.length);assert.equal(Reflect.ownKeys(outcomes).length,items.length+1);
 for(let i=0;i<items.length;i++){
  const outcome=own(outcomes,String(i));assert.equal(expectedOutcomes.get(outcome),items[i]);assert.equal(own(outcome,'accepted'),true);
 }
 return true;
}
export function classifySyntheticResult(raw,expectedChecks){
 let failureStage='PARSE_SYNTHETIC_RESULT',counts={};
 try{
  assert.equal(typeof raw,'string');assert.ok(Buffer.byteLength(raw)<=65536);const result=JSON.parse(raw);
  failureStage='VALIDATE_RESULT_SHAPE';
  assert.ok(result!==null&&typeof result==='object'&&!Array.isArray(result));
  assert.deepEqual(Object.keys(result).sort(),['checks','failed','passed']);
  failureStage='VALIDATE_RESULT_TYPES';
  assert.ok(Number.isSafeInteger(expectedChecks)&&expectedChecks>0&&expectedChecks<=1000);
  for(const value of Object.values(result))assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=expectedChecks);
  counts={native_checks:result.checks,native_passed:result.passed,native_failed:result.failed};
  failureStage='VALIDATE_PREDICATE_RESULTS';
  assert.deepEqual(result,{checks:expectedChecks,passed:expectedChecks,failed:0});
  return Object.freeze({ok:true,...counts});
 }catch{return Object.freeze({ok:false,failure_stage:failureStage,...counts});}
}
// Ports here are supplied only by the owning qualifier. This helper grants no
// target admission; verify() still performs every native Docker identity proof.
export function proveSyntheticNativeReadiness({verify,psql,wait,mark}){
 mark('WAIT_AUTHENTICATED_STARTUP_SELECT');let ready=false;
 for(let i=0;i<120&&!ready;i++){
  verify();ready=psql('supabase_admin','select 1',true)==='1';if(!ready)wait(1000);
 }
 assert.equal(ready,true);
 mark('WAIT_FINAL_HEALTH');let healthy=false;
 for(let i=0;i<120&&!healthy;i++){
  const state=verify();healthy=state.Running===true&&(!state.Health||state.Health.Status==='healthy');
  if(!healthy)wait(1000);
 }
 assert.equal(healthy,true);
 // Match the shipping runner's final image-init settling interval, then prove
 // the actual postgres session again. No SET ROLE, catalog replay or grants.
 mark('SETTLE_FINAL_SERVER');wait(10000);verify();
 mark('VERIFY_FINAL_NATIVE_OWNER');
 assert.equal(psql('postgres',"select current_user=session_user and current_user='postgres'",false),'t');
 verify();return Object.freeze({authenticated_startup_verified:true,final_health_verified:true,final_owner_verified:true});
}
export function qualifyImmutablePostgresAcls(){
 const owner=randomBytes(16).toString('hex'),name='mz_schema_rebuild_acl_qualification_'+owner,networkName=name+'_private_'+owner;
 const label='custodial.private-backup-rehearsal',ownerProfile={id:'immutable-private-current-postgres',actor:'postgres'};
 const deadline=Date.now()+180000,env={...Object.fromEntries(['PATH','HOME'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),LC_ALL:'C'};
 let cid,networkId,imageId,cleanupDeadline,stage='VERIFY_INSTALLED_IMAGE',stopping=false,receipt={schema:'custodial.synthetic-owner-acl-qualification.v1',ok:false,cleanup_checked:false,archive_accessed:false,production_accessed:false,roles_or_grants_changed:false};
 const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 const docker=(args,{input,cleanup=false,allowFailure=false,sqlStateOnly=false,expectedErrorCase=null}={})=>{
  if(!cleanup)assert.ok(!stopping&&Date.now()<deadline);else assert.ok(Date.now()<cleanupDeadline);
  if(expectedErrorCase!==null){
   assert.equal(cleanup,false);assert.equal(allowFailure,false);assert.equal(sqlStateOnly,true);
   assertExpectedAclInvocation(expectedErrorCase,args,input,cid);
  }
  const result=spawnSync('docker',args,{cwd:root,env,input,encoding:'utf8',timeout:Math.min(15000,(cleanup?cleanupDeadline:deadline)-Date.now()),killSignal:'SIGKILL',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});
  const diagnostic=syntheticSubprocessDiagnostic(result,sqlStateOnly);
  if(sqlStateOnly&&!cleanup)receipt.last_sql_process=diagnostic;
  if(expectedErrorCase!==null){
   const bound=expectedCases.get(expectedErrorCase),outcome=classifyExpectedAclRefusal(expectedErrorCase,
    {case_id:bound.case_id,source_sha256:bound.source_sha256,sql_sha256:bound.sql_sha256,process:result});
   if(!outcome.accepted){receipt.expected_error_refusal=outcome;throw new Error('EXPECTED_ACL_ERROR_REFUSED');}
   return outcome;
  }
  if(result.status!==0||result.error){
   if(allowFailure&&result.status!==null&&!result.error)return null;
   if(cleanup)receipt.cleanup_subprocess_failure=diagnostic;else receipt.subprocess_failure=diagnostic;
   throw new Error('OWNED_SYNTHETIC_SUBPROCESS_REFUSED');
  }
  return result.stdout.trim();
 };
 const inspect=()=>JSON.parse(docker(['inspect',cid]))[0];
 const verify=()=>{
  const pg=inspect();assert.equal(pg.Image,imageId);const address=assertOwnedPg(pg,{id:cid,name,owner,networkId,networkName,ownerProfile});
  assert.equal(pg.HostConfig.Memory,1073741824);assert.equal(pg.HostConfig.MemorySwap,1073741824);assert.equal(pg.HostConfig.NanoCpus,1000000000);assert.equal(pg.HostConfig.PidsLimit,256);
  assert.deepEqual(pg.HostConfig.Tmpfs,{'/var/lib/postgresql/data':'rw,size=1g'});
  const net=JSON.parse(docker(['network','inspect',networkId]))[0];
  assert.equal(net.Id,networkId);assert.equal(net.Name,networkName);assert.equal(net.Internal,true);assert.equal(net.Labels[label],owner);
  assert.deepEqual(Object.keys(net.Containers),[cid]);assert.equal(net.Containers[cid].Name,name);assert.equal(net.Containers[cid].IPv4Address.split('/')[0],address);
  return pg.State;
 };
 try{
  assert.equal(JSON.parse(docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}'])),'unix:///var/run/docker.sock');
  const image=JSON.parse(docker(['image','inspect',PG_IMAGE]))[0];assert.ok(image.RepoDigests.includes(PG_IMAGE));assert.match(image.Id,/^sha256:[0-9a-f]{64}$/);imageId=image.Id;
  const fixture=immutablePostgresAclFixtureSql();receipt.fixture_sha256=sha(fixture.sql);receipt.expected_checks=fixture.checks;
  receipt.expected_error_checks=fixture.expected_error_cases.length;receipt.total_checks=fixture.total_checks;receipt.batch_sha256=fixture.batch_sha256;
  stage='CREATE_OWNED_NETWORK';networkId=docker(['network','create','--internal','--label',label+'='+owner,networkName]);assert.match(networkId,/^[0-9a-f]{64}$/);
  stage='CREATE_OWNED_POSTGRES';cid=docker(['run','--pull=never','-d','--name',name,'--label',label+'='+owner,'--label','custodial.private-owner-profile='+ownerProfile.id,'--label','custodial.private-owner-actor=postgres','--network',networkName,
   '--memory','1g','--memory-swap','1g','--cpus','1','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',PG_IMAGE,
   'postgres','-D','/etc/postgresql','-c','listen_addresses=*','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','cron.database_name=postgres','-c','cron.launch_active_jobs=off']);assert.match(cid,/^[0-9a-f]{64}$/);
  stage='VERIFY_OWNED_POSTGRES';verify();
  const psql=(actor,sql,allowFailure=false)=>docker(['exec',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-v','SHOW_CONTEXT=never','-U',actor,'-d','postgres','-c',sql],{allowFailure,sqlStateOnly:true});
  Object.assign(receipt,proveSyntheticNativeReadiness({verify,psql,mark:value=>{stage=value;},wait:ms=>{
   assert.ok(!stopping&&Date.now()+ms<deadline);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
  }}));
  stage='EXECUTE_SYNTHETIC_SELECTS';
  const raw=docker(stdinPsqlArgs(cid),{input:fixture.sql,sqlStateOnly:true});
  const result=classifySyntheticResult(raw,fixture.checks);
  if(Object.hasOwn(result,'native_checks')){
   receipt.native_checks=result.native_checks;receipt.native_passed=result.native_passed;receipt.native_failed=result.native_failed;
  }
  if(!result.ok){stage=result.failure_stage;throw new Error('SYNTHETIC_RESULT_REFUSED');}
  stage='VERIFY_POST_SELECT_TARGET';verify();
  const outcomes=[];receipt.expected_error_results=[];receipt.expected_error_passed=0;
  for(const item of fixture.expected_error_cases){
   receipt.expected_error_case=item.case_id;stage='VERIFY_EXPECTED_EMPTY_ACL_TARGET';verify();
   stage='EXECUTE_EXPECTED_EMPTY_ACL';
   const outcome=docker(stdinPsqlArgs(cid),{input:item.sql,sqlStateOnly:true,expectedErrorCase:item});
   stage='VERIFY_EXPECTED_EMPTY_ACL_TARGET';verify();outcomes.push(outcome);receipt.expected_error_results.push(outcome);receipt.expected_error_passed=outcomes.length;
  }
  stage='VERIFY_EXPECTED_ERROR_BATCH';verifyExpectedAclBatch(fixture,outcomes);verify();
  receipt.total_passed=result.native_passed+outcomes.length;assert.equal(receipt.total_passed,fixture.total_checks);
  delete receipt.expected_error_case;receipt.ok=true;stage='FINISHED';
 }catch{receipt.failure_stage=stage;}
 finally{
  cleanupDeadline=Date.now()+45000;
  try{
   if(!cid){const found=docker(['ps','-aq','--no-trunc','--filter','name=^/'+name+'$','--filter','label='+label+'='+owner],{cleanup:true}).split('\n').filter(Boolean);assert.ok(found.length<=1);cid=found[0];}
   if(cid){const pg=JSON.parse(docker(['inspect',cid],{cleanup:true}))[0];assert.equal(pg.Id,cid);assert.equal(pg.Name,'/'+name);assert.equal(pg.Config.Image,PG_IMAGE);assert.equal(pg.Image,imageId);assert.equal(pg.Config.Labels[label],owner);docker(['rm','-f',cid],{cleanup:true});}
   const found=docker(['ps','-aq','--no-trunc','--filter','label='+label+'='+owner],{cleanup:true});assert.equal(found,'');
   const nets=docker(['network','ls','-q','--no-trunc','--filter','label='+label+'='+owner],{cleanup:true}).split('\n').filter(Boolean);assert.ok(nets.length<=1);
   if(nets.length){if(networkId)assert.equal(nets[0],networkId);const net=JSON.parse(docker(['network','inspect',nets[0]],{cleanup:true}))[0];assert.equal(net.Name,networkName);assert.equal(net.Internal,true);assert.equal(net.Labels[label],owner);assert.deepEqual(net.Containers,{});docker(['network','rm',net.Id],{cleanup:true});}
   assert.equal(docker(['network','ls','-q','--no-trunc','--filter','label='+label+'='+owner],{cleanup:true}),'');receipt.cleanup_checked=true;
  }catch{receipt.ok=false;receipt.cleanup_checked=false;receipt.cleanup_stage='OWNED_RESOURCE_CLEANUP_REFUSED';}
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
 }
 return Object.freeze(receipt);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=='--run-owned-synthetic')throw new Error('Explicit owned synthetic qualification required');
 const receipt=qualifyImmutablePostgresAcls();console.log(JSON.stringify(receipt));if(!receipt.ok||!receipt.cleanup_checked)process.exitCode=1;
}
