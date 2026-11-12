// Connection-free tests of the shipping synthetic qualifier. Never calls Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assertExpectedAclInvocation,classifyExpectedAclRefusal,verifyExpectedAclBatch,syntheticSubprocessDiagnostic,classifySyntheticResult,proveSyntheticNativeReadiness,immutablePostgresAclFixtureSql} from './qualify-immutable-postgres-acls.mjs';
const secret='PRIVATE employee Alice Example; SELECT salary FROM payroll; token=synthetic-secret';
const noPrivate=value=>assert.ok(!JSON.stringify(value).includes(secret));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('subprocess receipt carries only bounded primitive status, hashes and explicitly allowed SQLSTATE',()=>{
 const result={status:3,signal:null,error:undefined,stdout:secret,stderr:'psql:<stdin>:5: ERROR:  42601\n'+secret+'\n'};
 const receipt=syntheticSubprocessDiagnostic(result,true);
 assert.deepEqual(receipt,{exit_code:3,signal:null,timed_out:false,output_limit_exceeded:false,stdout_bytes:Buffer.byteLength(secret),stdout_sha256:hash(secret),stderr_bytes:Buffer.byteLength(result.stderr),stderr_sha256:hash(result.stderr),sql_state:'42601',private_payload_exported:false});
 noPrivate(receipt);assert.equal(syntheticSubprocessDiagnostic(result).sql_state,undefined);
 for(const stderr of ['ERROR:  ZZ999\n','ERROR:  42601 '+secret+'\n','prefix ERROR:  42601\n','psql:/private/payload:1: ERROR:  42601\n','ERROR:  42601\nERROR:  42501\n','x'.repeat(65537)+'\nERROR:  42601\n']){
  const projected=syntheticSubprocessDiagnostic({...result,stderr},true);assert.equal(projected.sql_state,undefined);noPrivate(projected);
 }
 for(const [code,field] of [['ETIMEDOUT','timed_out'],['ENOBUFS','output_limit_exceeded'],['EACCES','node_code'],['ENOENT','node_code']]){
  const projected=syntheticSubprocessDiagnostic({status:null,signal:'SIGKILL',error:Object.assign(new Error(secret),{code,stack:secret}),stdout:'',stderr:secret},true);
  assert.equal(projected.node_code,code);assert.equal(projected.signal,'SIGKILL');assert.ok(projected[field]);noPrivate(projected);
 }
 const unknown=syntheticSubprocessDiagnostic({status:999,signal:secret,error:{code:secret},stdout:'',stderr:secret},true);
 assert.equal(unknown.exit_code,null);assert.equal(unknown.signal,null);assert.equal(unknown.node_code,undefined);noPrivate(unknown);
});

test('diagnostic projection never reads hostile getters, proxy traps or stack operands',()=>{
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error(secret);},getPrototypeOf(){traps++;throw Error(secret);},getOwnPropertyDescriptor(){traps++;throw Error(secret);},ownKeys(){traps++;throw Error(secret);}});
 const accessor={};for(const field of ['status','signal','error','stdout','stderr'])Object.defineProperty(accessor,field,{get(){traps++;throw Error(secret);}});
 for(const value of [proxy,accessor,{status:0,signal:null,error:proxy,stdout:proxy,stderr:proxy}])noPrivate(syntheticSubprocessDiagnostic(value,true));
 const revoked=Proxy.revocable({},{});revoked.revoke();noPrivate(syntheticSubprocessDiagnostic(revoked.proxy,true));
 assert.equal(traps,0);
});

test('native result failure separates JSON parse, shape, types and predicate mismatch',()=>{
 const cases=[
  [secret,'PARSE_SYNTHETIC_RESULT'],['x'.repeat(65537),'PARSE_SYNTHETIC_RESULT'],
  ['null','VALIDATE_RESULT_SHAPE'],['[]','VALIDATE_RESULT_SHAPE'],['{}','VALIDATE_RESULT_SHAPE'],
  [JSON.stringify({checks:69,passed:69,failed:0,detail:secret}),'VALIDATE_RESULT_SHAPE'],
  [JSON.stringify({checks:'69',passed:69,failed:0}),'VALIDATE_RESULT_TYPES'],
  [JSON.stringify({checks:69,passed:true,failed:0}),'VALIDATE_RESULT_TYPES'],
  [JSON.stringify({checks:69,passed:-1,failed:70}),'VALIDATE_RESULT_TYPES'],
  [JSON.stringify({checks:69,passed:68,failed:1}),'VALIDATE_PREDICATE_RESULTS'],
  [JSON.stringify({checks:0,passed:0,failed:0}),'VALIDATE_PREDICATE_RESULTS'],
 ];
 for(const [raw,phase] of cases){const receipt=classifySyntheticResult(raw,69);assert.equal(receipt.ok,false);assert.equal(receipt.failure_stage,phase);noPrivate(receipt);
  assert.equal(Object.hasOwn(receipt,'native_checks'),phase==='VALIDATE_PREDICATE_RESULTS');}
 assert.deepEqual(classifySyntheticResult('{"checks":69,"passed":69,"failed":0}',69),{ok:true,native_checks:69,native_passed:69,native_failed:0});
});

test('readiness proves authenticated startup, final health, settling and exact final owner in order',()=>{
 const calls=[],stages=[];let initial=0,health=0;
 const result=proveSyntheticNativeReadiness({
  mark:stage=>{stages.push(stage);calls.push(stage);},verify:()=>{calls.push('verify');return {Running:true,Health:{Status:stages.at(-1)==='WAIT_FINAL_HEALTH'&&health++===0?'starting':'healthy'}};},
  psql:(actor,sql,allowFailure)=>{calls.push({actor,sql,allowFailure});if(actor==='supabase_admin')return initial++===0?null:'1';return 't';},wait:ms=>calls.push(ms),
 });
 assert.deepEqual(stages,['WAIT_AUTHENTICATED_STARTUP_SELECT','WAIT_FINAL_HEALTH','SETTLE_FINAL_SERVER','VERIFY_FINAL_NATIVE_OWNER']);
 assert.deepEqual(calls.filter(x=>typeof x==='number'),[1000,1000,10000]);
 const queries=calls.filter(x=>typeof x==='object');assert.equal(queries.length,3);assert.deepEqual(queries[0],{actor:'supabase_admin',sql:'select 1',allowFailure:true});
 assert.deepEqual(queries.at(-1),{actor:'postgres',sql:"select current_user=session_user and current_user='postgres'",allowFailure:false});
 assert.deepEqual(result,{authenticated_startup_verified:true,final_health_verified:true,final_owner_verified:true});
});

test('readiness fails closed on target drift, unhealthy final server, cancellation and wrong final owner',()=>{
 for(const mode of ['drift','not_authenticated','unhealthy','cancel','wrong_owner']){
  let phase,queries=0,finalQueries=0;
  assert.throws(()=>proveSyntheticNativeReadiness({mark:value=>{phase=value;},verify:()=>{if(mode==='drift')throw Error(secret);return {Running:true,Health:{Status:mode==='unhealthy'?'starting':'healthy'}};},
   psql:actor=>{queries++;if(actor==='postgres'){finalQueries++;return mode==='wrong_owner'?'f':'t';}return mode==='not_authenticated'?null:'1';},
   wait:ms=>{if(mode==='cancel'&&ms===10000)throw Error(secret);}}));
  assert.equal(finalQueries,mode==='wrong_owner'?1:0);if(mode==='drift')assert.equal(queries,0);
  if(mode==='not_authenticated')assert.equal(phase,'WAIT_AUTHENTICATED_STARTUP_SELECT');
  if(mode==='unhealthy')assert.equal(phase,'WAIT_FINAL_HEALTH');
 }
});

test('payload, resource guards and closed process flags remain fixed and SELECT-only',()=>{
 const fixture=immutablePostgresAclFixtureSql();assert.equal(fixture.checks,69);assert.equal(hash(fixture.sql),'a60e65a70432f53e5c7d1b7c69d399f58f6e8eb331eedae2ef7ef5c10df76578');
 assert.doesNotMatch(fixture.sql,/\b(?:create|alter|drop|insert|update|delete|revoke)\b/i);
 const source=readFileSync(new URL('./qualify-immutable-postgres-acls.mjs',import.meta.url),'utf8');
 assert.ok(!source.includes('pg_isready'));assert.equal((source.match(/'VERBOSITY=sqlstate','-v','SHOW_CONTEXT=never'/g)||[]).length,2);
 assert.ok(source.includes("stage='EXECUTE_SYNTHETIC_SELECTS'"));assert.ok(source.includes("stage='VERIFY_POST_SELECT_TARGET'"));
 assert.ok(source.includes("LC_ALL:'C'"));assert.ok(source.includes('Date.now()+180000'));assert.ok(source.includes('Date.now()+45000'));
 assert.ok(source.includes("'--pull=never'"));assert.ok(source.includes("'unix:///var/run/docker.sock'"));
 assert.ok(source.includes("assert.equal(pg.HostConfig.Memory,1073741824)"));assert.ok(source.includes("assert.equal(pg.HostConfig.PidsLimit,256)"));
});

test('existing isolated rehearsal default contract gate runs both dry suites without native opt-in',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/production-backup-migration-rehearsal.yml',import.meta.url),'utf8');
 const line=workflow.split('\n').find(line=>line.includes('node --test scripts/private-backup-only-rehearsal-tests.mjs'));
 assert.ok(line.includes('scripts/immutable-postgres-acl-qualification-tests.mjs'));
 assert.ok(!line.includes('--run-owned-synthetic'));
});

const observation=(item,process={status:3,signal:null,stdout:'',stderr:'ERROR:  22023\n'})=>({case_id:item.case_id,source_sha256:item.source_sha256,sql_sha256:item.sql_sha256,process});
const stdinArgs=cid=>['exec','-i',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-v','SHOW_CONTEXT=never','-U','postgres','-d','postgres'];

test('75-case batch keeps69 valid Boolean rows and six separately bound exact invalid-array SELECTs',()=>{
 const fixture=immutablePostgresAclFixtureSql();assert.equal(fixture.checks,69);assert.equal(fixture.total_checks,75);assert.equal(fixture.expected_error_cases.length,6);
 assert.equal(Buffer.byteLength(fixture.sql),55239);assert.equal(fixture.batch_sha256,'b903af3e203c31670bf4c3e531eee0ec75c9ced2f7dce28018f3941eee3928c6');
 assert.equal((fixture.sql.match(/'\{postgres=\/postgres\}'::aclitem\[\]/g)||[]).length,6);
 assert.ok(!fixture.sql.includes("'{}'::aclitem[]"));
 assert.deepEqual(fixture.expected_error_cases.map(x=>x.case_id),['DEVICE_CURRENT_EMPTY_ACL','DEVICE_LEGACY_EMPTY_ACL','MANAGER_CURRENT_EMPTY_ACL','MANAGER_LEGACY_EMPTY_ACL','EMPLOYEE_PUSH_CURRENT_EMPTY_ACL','EMPLOYEE_PUSH_LEGACY_EMPTY_ACL']);
 const ids=new Set();for(const item of fixture.expected_error_cases){
  assert.ok(Object.isFrozen(item));assert.ok(!ids.has(item.case_id));ids.add(item.case_id);
  assert.equal(Buffer.byteLength(item.sql),844);assert.equal(hash(item.sql),item.sql_sha256);assert.match(item.source_sha256,/^[0-9a-f]{64}$/);
  assert.ok(item.sql.startsWith('begin read only;'));assert.ok(item.sql.endsWith('rollback;\n'));assert.ok(item.sql.includes("'{}'::aclitem[]"));
  assert.doesNotMatch(item.sql,/\b(?:create|alter|drop|insert|update|delete|revoke)\b/i);
 }
 const names=['immutable-original-device-boundary-restore.sql','immutable-original-manager-push-restore.sql','immutable-original-employee-push-authority-restore.sql'];
 const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url),'utf8'));
 names.forEach((name,i)=>{
  const current=program.statements.find(s=>s.sourcePath==='proposals/'+name),legacy=readFileSync(new URL('../proposals/'+name,import.meta.url),'utf8');
  assert.equal(fixture.expected_error_cases[2*i].source_sha256,hash(current.sql));assert.equal(fixture.expected_error_cases[2*i+1].source_sha256,hash(legacy));
 });
});

test('expected-error admission binds exact original case, source, query, fixed argv and stdin',()=>{
 const fixture=immutablePostgresAclFixtureSql(),cid='a'.repeat(64);
 for(const item of fixture.expected_error_cases){
  assert.equal(assertExpectedAclInvocation(item,stdinArgs(cid),item.sql,cid),true);
  assert.throws(()=>assertExpectedAclInvocation({...item},stdinArgs(cid),item.sql,cid));
  assert.throws(()=>assertExpectedAclInvocation(item,stdinArgs(cid),item.sql+'\n',cid));
  for(const mutate of [a=>a[0]='run',a=>a[2]='b'.repeat(64),a=>a[4]='--other',a=>a[13]='supabase_admin',a=>a.push('--extra')]){
   const argv=stdinArgs(cid);mutate(argv);assert.throws(()=>assertExpectedAclInvocation(item,argv,item.sql,cid));
  }
  for(const key of ['case_id','source_sha256','sql_sha256']){
   const bad={...observation(item),[key]:secret};assert.equal(classifyExpectedAclRefusal(item,bad).accepted,false);noPrivate(classifyExpectedAclRefusal(item,bad));
  }
  assert.equal(classifyExpectedAclRefusal({...item},observation(item)).accepted,false);
  const wrong=fixture.expected_error_cases.find(x=>x!==item);assert.equal(classifyExpectedAclRefusal(item,observation(wrong)).accepted,false);
 }
});

test('only one exact22023 error with exit3 and no other failure/output is accepted',()=>{
 const item=immutablePostgresAclFixtureSql().expected_error_cases[0];
 for(const stderr of ['ERROR:  22023\n','psql:<stdin>:8: ERROR:  22023\n']){
  const outcome=classifyExpectedAclRefusal(item,observation(item,{status:3,signal:null,stdout:'',stderr}));assert.equal(outcome.accepted,true);assert.equal(outcome.process.sql_state,'22023');noPrivate(outcome);
 }
 const base={status:3,signal:null,stdout:'',stderr:'ERROR:  22023\n'};
 const bad=[{status:0,stdout:'',stderr:''},{status:0},{status:1},{status:2},{status:null},{signal:'SIGKILL'},{signal:secret},{error:{}},{error:{code:'ETIMEDOUT'}},{error:{code:'ENOBUFS'}},{stdout:'1'},{stdout:secret},{stderr:''},{stderr:'ERROR:  42501\n'},{stderr:'FATAL:  22023\n'},
  ...['ERROR:  ZZ999\n','ERROR:  42501\n','ERROR:  22023\n',secret+'\n','\n'].map(extra=>({stderr:base.stderr+extra}))];
 for(const fields of bad){const outcome=classifyExpectedAclRefusal(item,observation(item,{...base,...fields}));assert.equal(outcome.accepted,false);noPrivate(outcome);}
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error(secret);},getOwnPropertyDescriptor(){traps++;throw Error(secret);},getPrototypeOf(){traps++;throw Error(secret);},ownKeys(){traps++;throw Error(secret);}});
 assert.equal(classifyExpectedAclRefusal(item,proxy).accepted,false);assert.equal(classifyExpectedAclRefusal(item,observation(item,proxy)).accepted,false);assert.equal(traps,0);
});

test('complete expected-error batch refuses omitted, duplicate, copied, foreign and failed outcomes',()=>{
 const fixture=immutablePostgresAclFixtureSql(),outcomes=fixture.expected_error_cases.map(item=>classifyExpectedAclRefusal(item,observation(item)));
 assert.equal(verifyExpectedAclBatch(fixture,outcomes),true);
 assert.throws(()=>verifyExpectedAclBatch({...fixture},outcomes));
 for(const bad of [[],outcomes.slice(0,-1),[...outcomes,outcomes[0]],outcomes.map(x=>({...x})),outcomes.map(()=>outcomes[0]),[outcomes[1],outcomes[0],...outcomes.slice(2)]])assert.throws(()=>verifyExpectedAclBatch(fixture,bad));
 const other=immutablePostgresAclFixtureSql();assert.throws(()=>verifyExpectedAclBatch(other,outcomes));
 const failed=[...outcomes];failed[0]=classifyExpectedAclRefusal(fixture.expected_error_cases[0],observation(fixture.expected_error_cases[0],{status:0,signal:null,stdout:'',stderr:''}));assert.throws(()=>verifyExpectedAclBatch(fixture,failed));
 const source=readFileSync(new URL('./qualify-immutable-postgres-acls.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf("if(!result.ok){stage=result.failure_stage")<source.indexOf('for(const item of fixture.expected_error_cases)'));
 assert.ok(source.includes('assert.equal(allowFailure,false);assert.equal(sqlStateOnly,true)'));
 assert.ok(source.indexOf('assertExpectedAclInvocation(expectedErrorCase,args,input,cid)')<source.indexOf("const result=spawnSync('docker'"));
 assert.ok(source.includes('verifyExpectedAclBatch(fixture,outcomes);verify()'));
 assert.equal(classifySyntheticResult('{}',69).ok,false);
});
