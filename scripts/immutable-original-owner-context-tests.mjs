import {recordImmutableFreshFailure,readImmutableFreshFailure,classifyImmutableImportPermission,classifyImmutableImportPermissionContext,classifyImmutableImportGuard} from './immutable-private-stage-diagnostic.mjs';
import './isolated-current-postgres-cron-setup-tests.mjs';
import './isolated-current-vendor-privileges-tests.mjs';
import './immutable-current-data-schema-scope-tests.mjs';
import {privateRestoreStageDiagnostic,projectPrivateRestoreDiagnostic,privateEvidenceReceipt} from './run-official-local-storage-rehearsal.mjs';
// Exact shipping closures with inert recording clients. These tests prove
// actor plumbing/refusal order only; they do not assert native SQL admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {types,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
const text=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const load=(file,deps,result)=>{deps={recordImmutableFreshFailure,classifyImmutableImportPermission,classifyImmutableImportPermissionContext,classifyImmutableImportGuard,...deps};return new Function(...Object.keys(deps),text(file)
 .replace(/^import\s[\s\S]*?;\n/gm,'').replaceAll('export async function','async function')+'\nreturn '+result+';')(...Object.values(deps));};
const profiles=[
 Object.freeze({id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'}),
 Object.freeze({id:'immutable-private-current-postgres',actor:'postgres'}),
];
const checkpoint=new Error('INERT_NATIVE_CHECKPOINT');
test('unsupported INSERT guard diagnosis exports only catalog-bound schema and digests through the actual receipt chain',()=>{
 const detail={schema:'public',table:'private_table',trigger:'private_trigger',function_identity:'public.private_function()',tgtype:7,enabled:'O',owner:'postgres',function_sha256:'a'.repeat(64)};
 const tables=[{schema_name:'public',table_name:'private_table'}],cause=Object.assign(new Error('IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED'),{code:'55000',detail:JSON.stringify(detail)});
 const value=classifyImmutableImportGuard(cause,tables),sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 assert.deepEqual(value,{guard_schema:'public',guard_relation_sha256:sha(['public','private_table']),guard_trigger_sha256:sha(['public','private_table','private_trigger']),guard_function_sha256:'a'.repeat(64)});
 assert.doesNotMatch(JSON.stringify(value),/private_table|private_trigger|private_function|postgres/);
 const error=Object.assign(new Error('PRIVATE SQL'),{code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED',sql_state:'55000',import_refusal:cause.message});
 recordImmutableFreshFailure(error,{import_operation:'BEGIN_IMPORT',...value});
 const projected=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',error);assert.deepEqual(projectPrivateRestoreDiagnostic(projected),projected);
 const receipt=privateEvidenceReceipt('018.stderr',Buffer.from(JSON.stringify({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',private_payload_exported:false,restore_diagnostics:[projected]})));
 assert.deepEqual(receipt.restore_diagnostics,[projected]);
 for(const change of [{function_sha256:'PRIVATE'},{row:'PRIVATE ROW'},{tgtype:-1},{schema:'unknown'},{table:'not_in_catalog'},{enabled:'D'}]){
  const invalid=Object.assign(new Error(cause.message),{code:'55000',detail:JSON.stringify({...detail,...change})});assert.deepEqual(classifyImmutableImportGuard(invalid,tables),{});
 }
 assert.deepEqual(classifyImmutableImportGuard(Object.assign(new Error('other'),{code:'55000',detail:cause.detail}),tables),{});
 let traps=0;const getter={code:'55000',message:cause.message};Object.defineProperty(getter,'detail',{get(){traps++;return cause.detail;}});assert.deepEqual(classifyImmutableImportGuard(getter,tables),{});assert.equal(traps,0);
});
test('native permission context exposes only an authenticated-catalog schema and fixed operation, omitting ambiguous names',()=>{
 const cause=Object.assign(new Error('permission denied for table private_records'),{code:'42501',where:'SQL statement "LOCK TABLE auth.private_records IN ACCESS EXCLUSIVE MODE"\nPRIVATE ROW AND SQL'});
 const tables=[{schema_name:'auth',table_name:'private_records'}],value=classifyImmutableImportPermissionContext(cause,tables);
 assert.deepEqual(value,{import_relation_schema:'auth',import_native_operation:'LOCK_RELATION_ACCESS_EXCLUSIVE'});
 assert.doesNotMatch(JSON.stringify(value),/private_records|PRIVATE ROW|PRIVATE SQL/);
 assert.equal(classifyImmutableImportPermissionContext(cause,[...tables,{schema_name:'public',table_name:'private_records'}]).import_relation_schema,undefined);
 assert.equal(classifyImmutableImportPermissionContext(cause,[{schema_name:'unknown',table_name:'private_records'}]).import_relation_schema,undefined);
 assert.equal(classifyImmutableImportPermissionContext(cause,[{schema_name:'auth',table_name:'different'}]).import_relation_schema,undefined);
 const count=Object.assign(new Error(cause.message),{code:'42501',where:'SQL statement "SELECT count(*) FROM ONLY auth.private_records"'});
 assert.equal(classifyImmutableImportPermissionContext(count,tables).import_native_operation,'COUNT_RELATION_ROWS');
 let traps=0;const hostile={schema_name:'auth'};Object.defineProperty(hostile,'table_name',{get(){traps++;return 'private_records';}});
 assert.equal(classifyImmutableImportPermissionContext(cause,[hostile]).import_relation_schema,undefined);assert.equal(traps,0);
 const error=Object.assign(new Error('PRIVATE SQL'),{sql_state:'42501',code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'});
 recordImmutableFreshFailure(error,{import_operation:'BEGIN_IMPORT',fresh_refusal:'NATIVE_RELATION_ACCESS_DENIED',...value});
 const projected=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',error);assert.deepEqual(projectPrivateRestoreDiagnostic(projected),projected);
 const receipt=privateEvidenceReceipt('018.stderr',Buffer.from(JSON.stringify({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',private_payload_exported:false,restore_diagnostics:[projected]})));
 assert.deepEqual(receipt.restore_diagnostics,[projected]);
});
test('private import permission diagnostics retain only closed class and operation, never native errors or identifiers',()=>{
 const source=text('./immutable-private-data-import.mjs'),start=source.indexOf('function fail('),end=source.indexOf('\nfunction closed(',start);
 assert.ok(start>0&&end>start);
 const throwFailure=new Function('privateFailures','types','recordImmutableFreshFailure','classifyImmutableImportPermission',
  source.slice(start,end)+'\nreturn fail;')(new WeakMap(),types,recordImmutableFreshFailure,classifyImmutableImportPermission);
 for(const [message,label] of [['permission denied for table private_personal_records','NATIVE_RELATION_ACCESS_DENIED'],
  ['permission denied for schema private_payroll','NATIVE_SCHEMA_ACCESS_DENIED'],['permission denied for function private_salary','NATIVE_FUNCTION_EXECUTE_DENIED'],
  ['query would be affected by row-level security policy for table "private_payroll"','NATIVE_ROW_SECURITY_DENIED'],
  ['PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED','IMPORT_GUARD_CONTEXT_DENIED']]){
  const cause=Object.assign(new Error(message),{code:'42501',detail:'PRIVATE ROW AND SQL'}),kind=classifyImmutableImportPermission(cause);assert.equal(kind,label);
  let error;try{throwFailure(cause,'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED',{import_operation:'BEGIN_IMPORT'});}catch(value){error=value;}
  assert.equal(error.code,'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED');assert.equal(error.sql_state,'42501');
  const value=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',error);
  assert.equal(value.import_operation,'BEGIN_IMPORT');assert.equal(value.fresh_refusal,label);assert.deepEqual(projectPrivateRestoreDiagnostic(value),value);
  assert.doesNotMatch(JSON.stringify(value),/private_personal|private_payroll|private_salary|PRIVATE ROW|PRIVATE SQL/);
  const receipt=privateEvidenceReceipt('018.stderr',Buffer.from(JSON.stringify({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',private_payload_exported:false,restore_diagnostics:[value]})));
  assert.deepEqual(receipt.restore_diagnostics,[value]);
 }
 for(const cause of [Object.assign(new Error('PRIVATE UNKNOWN'),{code:'42501'}),Object.assign(new Error('permission denied for table private_records'),{code:'55000'}),new Proxy({},{})])assert.equal(classifyImmutableImportPermission(cause),undefined);
 let traps=0;const cause={code:'42501'};Object.defineProperty(cause,'message',{get(){traps++;return 'PRIVATE';}});
 assert.equal(classifyImmutableImportPermission(cause),undefined);assert.equal(traps,0);
});
test('existing original-import guard reason survives closed public metadata without exposing its raw cause',()=>{
 const error=Object.assign(new Error('PRIVATE SQL CAUSE'),{code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED',sql_state:'55000',import_refusal:'Immutable import full target catalog mismatch'});
 recordImmutableFreshFailure(error,{fresh_stage:'IMPORT_ORIGINAL_DATA'});
 const value=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',error);
 assert.equal(value.fresh_refusal,'IMPORT_FULL_TARGET_CATALOG_MISMATCH');assert.equal(value.sql_state,'55000');
 assert.deepEqual(projectPrivateRestoreDiagnostic(value),value);
 const receipt=privateEvidenceReceipt('018.stderr',Buffer.from(JSON.stringify({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',private_payload_exported:false,restore_diagnostics:[value]})));
 assert.equal(receipt.restore_diagnostics[0].fresh_refusal,'IMPORT_FULL_TARGET_CATALOG_MISMATCH');assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE SQL|raw cause|message|stack/);
 for(const patch of [{code:'other'},{sql_state:'42501'},{import_refusal:'PRIVATE SQL UNKNOWN'}]){
  const changed=Object.assign(new Error('SECRET'),{code:error.code,sql_state:error.sql_state,import_refusal:error.import_refusal},patch);
  assert.deepEqual(readImmutableFreshFailure(changed),{});
 }
 let traps=0;const getter={code:error.code,sql_state:error.sql_state};Object.defineProperty(getter,'import_refusal',{get(){traps++;return error.import_refusal;}});
 assert.deepEqual(readImmutableFreshFailure(getter),{});assert.equal(traps,0);
});
test('metadata refusal stage survives the actual closed diagnostic and evidence chain without SQL or row payloads',()=>{
 for(const stage of ['RESTORE_METADATA','RESTORE_MIGRATION_LEDGER','RESTORE_CRON','RESTORE_RELEASES','RESTORE_REGISTRY','VERIFY_RESTORED_METADATA']){
  const error=Object.assign(new Error('PRIVATE SQL AND ROW VALUES MUST NOT ESCAPE'),{code:'42501'});
  recordImmutableFreshFailure(error,{initializer_stage:stage,initializer_operation:'EXECUTE_QUERY',source_statement:'01'});
  const diagnostic=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',error);
  assert.equal(diagnostic.initializer_stage,stage);assert.equal(diagnostic.sql_state,'42501');assert.equal(diagnostic.source_statement,undefined);
  assert.deepEqual(projectPrivateRestoreDiagnostic(diagnostic),diagnostic);
  const receipt=privateEvidenceReceipt('018.stderr',Buffer.from(JSON.stringify({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',private_payload_exported:false,restore_diagnostics:[diagnostic]})));
  assert.deepEqual(receipt.restore_diagnostics,[diagnostic]);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE SQL|ROW VALUES|message|stack/);
 }
 const unknown=Object.assign(new Error('SECRET'),{code:'42501'});recordImmutableFreshFailure(unknown,{initializer_stage:'ARBITRARY SQL'});
 assert.deepEqual(readImmutableFreshFailure(unknown),{});
});
function initializerFixture(profile,mode){
 let calls=0,withdrawn=false;
 const archive=Object.freeze({}),source=Object.freeze({inventory:{
  'inventory/table-catalog.json':'[]','inventory/original-relations.json':'[{"schema_name":"public","table_name":"fixture"}]'}});
 const row={actor:profile.actor,session_actor:profile.actor,readonly:'off',replication:'origin',row_security:'off',search_path:'pg_catalog',
  database:'UNIT_ONLY',database_oid:'5',backend_pid:411,transaction_id:'1285',database_owner:'postgres',dr_owner:'postgres',
  original_owned_relations:5,active_leases:0,held_fences:2};
 if(mode==='actor')row.actor=row.session_actor=profile.actor==='postgres'?'supabase_admin':'postgres';
 if(mode==='session')row.session_actor='other_owner';
 if(mode==='control')row.original_owned_relations=4;
 if(mode==='fence')row.held_fences=1;
 class RecordingClient{async query(sql){
  assert.match(sql,/to_regclass\('custodial_dr.restore_control'\)/);
  assert.match(sql,/relowner=\(select oid from pg_catalog.pg_roles where rolname=current_user\)/);
  calls++;if(calls===3)throw checkpoint;if(mode==='withdraw')withdrawn=true;
  return {rowCount:1,rows:[row]};
 }}
 const current=(s,a)=>{assert.equal(s,source);assert.equal(a,archive);if(withdrawn)throw Error('WITHDRAWN');};
 const fn=load('./immutable-private-source-initializer.mjs',{assert,types,isDeepStrictEqual,createHash,pg:{Client:RecordingClient},
  prepareVerifiedImmutableBootstrapSource:async a=>{assert.equal(a,archive);return source;},
  assertVerifiedImmutableBootstrapSource:current,readVerifiedImmutableBootstrapOwnerProfile:(s,a)=>{current(s,a);return profile;},
  readVerifiedImmutableBootstrapStatement:()=>{throw Error('NO PROGRAM EXPECTED');}},'initializeVerifiedImmutableFreshSource');
 return {run:()=>fn({db:new RecordingClient(),verifiedArchive:archive}),calls:()=>calls};
}
for(const profile of profiles)test('initializer binds '+profile.id+' and rejects wrong native actor/session/control/fence/withdrawal',async()=>{
 for(const mode of ['valid','actor','session','control','fence','withdraw']){
  const f=initializerFixture(profile,mode);await assert.rejects(f.run,mode==='valid'?e=>e===checkpoint:()=>true);
  assert.equal(f.calls(),mode==='valid'?3:1);
 }
});
function controlFixture(profile,mode){
 let calls=0,withdrawn=false;
 const archive={},token={},original={intent:{authority_generation:1,retry_of_restore_id:null,resume_after_verification:false},
  sourceBinding:{source_identity:{release:{}}},envelope:{}};
 const ready={state:'READY',authority_generation:'0',mutations_paused:false,restore_id:null,archive_digest:null,
  source_project_ref:null,target_project_ref:null,release_identity:{},started_by:null,started_at:null,completed_at:null,failure_reason:null};
 const row={database_oid:'5',backend_pid:411,transaction_id:'1285',actor:profile.actor,session_actor:profile.actor,
  database_owner:'postgres',dr_owner:'postgres',control_owner:profile.actor,replication:'origin',row_security:'off',search_path:'pg_catalog',
  read_only:'off',lease_count:'0',held_fences:2,control_count:1,control:ready,manifest_count:0,manifest:null,events_count:0};
 if(mode==='actor')row.actor=row.session_actor=profile.actor==='postgres'?'supabase_admin':'postgres';
 if(mode==='session')row.session_actor='other_owner';if(mode==='control')row.control_owner='other_owner';
 class RecordingClient{async query(sql){calls++;if(calls===3)throw checkpoint;
  assert.match(sql,/pg_get_userbyid\(relowner\)[\s\S]*control_owner/);
  if(mode==='withdraw')withdrawn=true;return {rowCount:1,rows:[row]};}}
 const fn=load('./immutable-private-fresh-restore-control.mjs',{assert,types,pg:{Client:RecordingClient},
  readVerifiedImmutableFreshRestoreIntent:(t,a)=>{assert.equal(t,token);assert.equal(a,archive);return original;},
  readVerifiedImmutableArchiveOwnerProfile:a=>{assert.equal(a,archive);if(withdrawn||mode==='forged')throw Error('UNAUTHENTICATED');return profile;}},
  'prepareVerifiedImmutableFreshRestoreControl');
 return {run:()=>fn({db:new RecordingClient(),verifiedArchive:archive,freshIntent:token}),calls:()=>calls};
}
for(const profile of profiles)test('control proves target-created owner for '+profile.id+' before effects',async()=>{
 for(const mode of ['valid','actor','session','control','withdraw','forged']){
  const f=controlFixture(profile,mode);await assert.rejects(f.run,mode==='valid'?e=>e===checkpoint:()=>true);
  assert.equal(f.calls(),mode==='valid'?3:mode==='forged'?0:1);
 }
});
function recordFixture(profile,mode){
 let queries=0,withdrawn=false,preparations=0;
 const archive={},token={},intent={restore_id:'11111111-1111-1111-1111-111111111111',authority_generation:1,
  archive_digest:'a'.repeat(64),target_project_ref:'UNIT_ONLY',actor:'UNIT requested human'},sourceBinding={archive_digest:'a'.repeat(64),
  project_ref:'UNIT_ONLY',source_identity:{release:{}}},original={intent,sourceBinding,envelope:{}};
 const finished=Object.freeze({database_oid:'5',backend_pid:411,transaction_id:'1285',restore_id:intent.restore_id,
  authority_generation:'1',archive_digest:intent.archive_digest,private_rows:'0',transaction_authority:false,admission_resumed:false});
 const evidence=Object.freeze({database:Object.freeze({unit:true}),event:Object.freeze({unit:true})});
 class RecordingClient{async query(sql,args){queries++;
  assert.match(sql,/current_user=session_user and current_user=\$13::text/);
  assert.match(sql,/current_user=\(select pg_catalog.pg_get_userbyid\(relowner\)/);
  assert.match(sql,/to_regclass\('custodial_dr.restore_control'\) and relkind='r'/);
  assert.equal(args.length,13);assert.equal(args[12],profile.actor);assert.equal(args[5],intent.actor);
  if(mode==='withdraw-write')withdrawn=true;
  return {rowCount:1,rows:[{control_count:mode==='native-refusal'?0:1,manifest_count:mode==='native-refusal'?0:1,
   event_count:mode==='native-refusal'?0:1,...Object.fromEntries(Object.entries(finished).filter(([key])=>
    !['private_rows','transaction_authority','admission_resumed'].includes(key)))}]};}}
 const fn=load('./immutable-private-fresh-restore-record.mjs',{assert,types,pg:{Client:RecordingClient},
  readVerifiedImmutableFreshRestoreIntent:(t,a)=>{assert.equal(t,token);assert.equal(a,archive);return original;},
  readVerifiedImmutableArchiveOwnerProfile:a=>{assert.equal(a,archive);if(withdrawn||mode==='forged')throw Error('UNAUTHENTICATED');return profile;},
  readVerifiedImmutableFreshCommitPreparation:async()=>{preparations++;if(mode==='withdraw-preparation')withdrawn=true;return finished;},
  readVerifiedImmutableFreshCommitRecord:async()=>finished,buildVerifiedImmutableFreshDatabaseEvidence:()=>evidence},
  'recordVerifiedImmutableFreshDatabaseEvidence');
 const db=new RecordingClient();return {run:(extra={})=>fn({db,verifiedArchive:archive,freshIntent:token,...extra}),queries:()=>queries,preparations:()=>preparations};
}
for(const profile of profiles)test('DATABASE record binds only authenticated '+profile.id+' and never retries uncertain writes',async()=>{
 for(const mode of ['valid','forged','withdraw-preparation','withdraw-write','native-refusal']){
  const f=recordFixture(profile,mode);
  if(mode==='valid')assert.deepEqual(await f.run(),{database:{unit:true},event:{unit:true}});else await assert.rejects(f.run);
  assert.equal(f.queries(),['valid','withdraw-write','native-refusal'].includes(mode)?1:0);
  const before=f.queries();await assert.rejects(f.run);assert.equal(f.queries(),before);
 }
 const caller=recordFixture(profile,'valid');await assert.rejects(()=>caller.run({ownerProfile:profiles[1]}));assert.equal(caller.queries(),0);
});
test('ACL and committed-frame consumers retain native equality and branded statement validation',()=>{
 const acl=text('./immutable-private-source-acl.mjs'),importer=text('./immutable-private-data-import.mjs');
 assert.match(acl,/readVerifiedImmutableBootstrapOwnerProfile\(source,archive\)/);
 assert.match(acl,/when 'custodial_release_identity' then \$1::text end/);
 assert.match(acl,/raw\(contextSql,\[ownerProfile.actor\]\)/);
 assert.match(acl,/pg_get_userbyid\(c.relowner\)=current_user/);
 assert.match(acl,/assert.equal\(value.actor,ownerProfile.actor\)/);
 assert.match(importer,/frame.actor!==ownerProfile.actor\|\|frame.session_actor!==frame.actor\|\|frame.control_owner!==frame.actor/);
 assert.match(importer,/readVerifiedImmutableBootstrapStatement\(descriptor.source,verifiedArchive,recipes\[0\]\)/);
 assert.doesNotMatch(importer,/committedAuthoritySourceSha256/);
 // The builtin codec owner is not the restore actor and remains pinned.
 assert.match(importer,/ti.proowner='supabase_admin'::pg_catalog.regrole/);
});
function comparatorFixture(profile,kind,mode){
 const code=text('./immutable-private-data-import.mjs'),name=kind==='private'?'compareVerifiedImmutablePrivateTableData':'compareVerifiedImmutableOrdinaryTableData';
 const start=code.indexOf('export async function '+name+'('),end=kind==='private'?code.indexOf('// Ordinary original DATA only',start):code.length;
 assert.ok(start>0&&end>start);
 const archive={},sourceBinding={},column={name:'id',data_type:'text',generated:'',identity:''};
 const table=(schema_name,table_name)=>({schema_name,table_name,data_file:`database/${schema_name}.${table_name}.jsonl`,
  data_encoding:'UNIT_V1',row_count:'0',columns:[column],primary_key:['id']});
 const privateTables=['employee_message_original_outcomes','group_original_creations'].map(name=>table('custodial_release_identity',name));
 const original={sourceBinding,selection:{privateTables,databaseTables:[...privateTables,table('auth','fixture'),
  table('public','release_deployment_manifest'),table('public','custodial_release_authority_restore_inventory')]},
  privateDataMembers:privateTables.map(t=>({...t,bytes:'0',sha256:'a'.repeat(64)}))};
 let calls=0,withdrawn=false;
 const context={database_oid:'5',database_name:'UNIT_ONLY',backend_pid:411,actor:profile.actor,session_actor:profile.actor,
  control_owner:profile.actor,transaction_id:'1285',virtual_xid:'1/1',snapshot_id:'1:2:',transaction_started_at:'UNIT_TIME',
  read_only:'on',isolation:'repeatable read',row_security:'off',search_path:'pg_catalog',first_schema:'pg_catalog',float_digits:'3',
  ...(kind==='ordinary'?{timezone:'UTC',date_style:'ISO, YMD',interval_style:'postgres'}:{})};
 if(mode==='actor')context.actor=context.session_actor=profile.actor==='postgres'?'supabase_admin':'postgres';
 if(mode==='session')context.session_actor='other_owner';if(mode==='control')context.control_owner='other_owner';
 class RecordingClient{async query(sql){calls++;if(calls===2)throw checkpoint;
  assert.match(sql,/'control_owner',[\s\S]*to_regclass\('custodial_dr.restore_control'\)/);
  if(mode==='withdraw')withdrawn=true;return {command:'SELECT',rowCount:1,rows:[{context}]};}}
 const deps={types,isDeepStrictEqual,pg:{Client:RecordingClient},
  closed:(v,keys)=>{assert.ok(v&&Object.getPrototypeOf(v)===Object.prototype);assert.deepEqual(Object.keys(v).sort(),keys.slice().sort());return v;},
  readVerifiedPrivateImportSource:a=>{assert.equal(a,archive);return original;},sameSource:(a,o)=>{assert.equal(a,archive);assert.equal(o,original);},
  readVerifiedImmutableArchiveOwnerProfile:a=>{assert.equal(a,archive);if(mode==='forged'||withdrawn)throw Error('UNAUTHENTICATED');return profile;},
  readVerifiedImmutableBootstrapInventory:()=>({sourceBinding,inventory:{'inventory/application-schema.sql':'UNIT_SCHEMA'}}),
  deriveOriginalAuthEnumDescriptors:()=>[],committedAuthorityDataReads:new WeakMap(),committedAuthorityOrdinaryReads:new WeakSet(),
  postgresJsonTextLineEncoding:'UNIT_V1',postgresTextColumnsLineEncoding:'UNIT_V2'};
 const fn=new Function(...Object.keys(deps),'const Client=pg.Client,query=Client.prototype.query;\n'+
  code.slice(start,end).replace('export async function','async function')+'\nreturn '+name+';')(...Object.values(deps));
 return {run:()=>fn({db:new RecordingClient(),verifiedArchive:archive}),calls:()=>calls};
}
for(const profile of profiles)for(const kind of ['private','ordinary'])test(kind+' readback binds '+profile.id+' to native session and control owner',async()=>{
 for(const mode of ['valid','actor','session','control','withdraw','forged']){
  const f=comparatorFixture(profile,kind,mode),result=await f.run();assert.equal(result.state,'UNSUPPORTED');
  assert.equal(f.calls(),mode==='valid'?2:mode==='forged'?0:1);
 }
});

test('initializer records exact pinned statement refusal without changing error identity or continuing',async()=>{
 for(const profile of profiles)for(let ordinal=1;ordinal<=13;ordinal++){
  const archive={},executed=[],error=Object.assign(new Error('Exact original messenger function/ACL/trigger predecessor differs'),{code:'55000'});
  const context={actor:profile.actor,session_actor:profile.actor,readonly:'off',replication:'origin',row_security:'off',search_path:'pg_catalog',database:'UNIT_ONLY',database_oid:'5',backend_pid:411,transaction_id:'1285',database_owner:'postgres',dr_owner:'postgres',original_owned_relations:5,active_leases:0,held_fences:2};
  const relations=[{schema_name:'public',table_name:'fixture',relation_kind:'r',is_partition:false}];
  const recipes=Array.from({length:25},(_,i)=>({identity:'public.fixture_'+i+'()',before:'UNIT '+i,beforeBodyHash:createHash('sha256').update('BODY '+i).digest('hex')}));
  const source={inventory:{'inventory/table-catalog.json':'[]','inventory/original-relations.json':JSON.stringify(relations)},recipes,statements:Array.from({length:13},(_,i)=>'PINNED_STATEMENT_'+(i+1))};
  class RecordingClient{async query(sql){
   if(sql.startsWith('select current_user actor'))return {rowCount:1,rows:[context]};
   if(sql.startsWith('select n.nspname'))return {rows:relations};
   if(sql.startsWith('select proparallel'))return {rowCount:1,rows:[{counter_parallel_safety:'u'}]};
   if(sql.startsWith('select schema_name,table_name,row_count'))return {rowCount:1,rows:[{schema_name:'public',table_name:'fixture',row_count:'0',transaction_id:'1285'}]};
   if(sql.startsWith('select (select count(*)::int'))return {rows:[{controls:0,manifests:0,events:0,migrations:0,jobs:0,existing_import:null}]};
   if(sql.startsWith('insert into custodial_dr.restore_control'))return {rowCount:1,rows:[]};
   if(sql.startsWith('select i.ordinality'))return {rowCount:25,rows:recipes.map((r,i)=>({ordinal:i+1,identity:r.identity,definition:r.before,prosrc:'BODY '+i,owner:profile.actor}))};
   assert.ok(source.statements.includes(sql));executed.push(sql);if(executed.length===ordinal)throw error;return {rows:[]};
  }}
  const fn=load('./immutable-private-source-initializer.mjs',{assert,types,isDeepStrictEqual,createHash,pg:{Client:RecordingClient},
   prepareVerifiedImmutableBootstrapSource:async()=>source,assertVerifiedImmutableBootstrapSource:()=>{},readVerifiedImmutableBootstrapOwnerProfile:()=>profile,
   reconcileVerifiedImmutableBootstrapAcls:async()=>({}),readVerifiedImmutableBootstrapStatement:(s,a,statement)=>{assert.equal(s,source);assert.equal(a,archive);return statement;}},'initializeVerifiedImmutableFreshSource');
  await assert.rejects(fn({db:new RecordingClient(),verifiedArchive:archive}),e=>e===error);
  assert.equal(executed.length,ordinal);
  assert.deepEqual(readImmutableFreshFailure(error),{initializer_stage:'INSTALL_PINNED_STATEMENT',initializer_operation:'EXECUTE_QUERY',source_statement:String(ordinal).padStart(2,'0'),fresh_refusal:'MESSENGER_PREDECESSOR_DIFFERS'});
 }
});

test('fresh composition labels original initializer/control/snapshot/import refusals and stops',async()=>{
 const source=text('./immutable-private-data-import.mjs'),start=source.indexOf('export async function stageVerifiedImmutableFreshData(options)'),end=source.indexOf('// One original fresh DATA transaction decision.',start);
 assert.ok(start>=0&&end>start);const body=source.slice(start,end).replace('export async function','async function');
 for(const [failed,phase] of [['initialize','INITIALIZE_SOURCE'],['control','PREPARE_RESTORE_CONTROL'],['snapshot','CAPTURE_PRE_RESTORE_STATE'],['import','IMPORT_ORIGINAL_DATA']]){
  const error=Object.assign(new Error('UNIT PRIVATE PAYLOAD'),{code:'55000'}),calls=[],archive={},dbClass=class{query(){}},db=new dbClass(),intent={restore_id:'UNIT',authority_generation:1,target_project_ref:'UNIT'},binding={archive_digest:'a'.repeat(64)};
  const original={selection:{privateTables:[{table_name:'employee_message_original_outcomes'},{table_name:'group_original_creations'}],databaseTables:[]},privateDataMembers:[{data_encoding:'TEXT',row_count:'0'},{data_encoding:'TEXT',row_count:'0'}],sourceBinding:binding};
  const captured={sourceBinding:binding,intent,envelope:{}},witness={database_oid:'5',backend_pid:411,transaction_id:'1285',restore_id:'UNIT',authority_generation:'1',archive_digest:binding.archive_digest};
  const enter=key=>{calls.push(key);if(key===failed)throw error;};
  const deps={types,isDeepStrictEqual,recordImmutableFreshFailure,Client:dbClass,query:dbClass.prototype.query,closed:v=>v,fail:()=>{throw Error('UNEXPECTED FAILURE');},captureFreshNativePort:()=>({}),sameFreshNativePort:()=>{},nativeData:()=> 'T',freshClients:new WeakSet(),freshArchives:new WeakSet(),freshStaged:new WeakMap(),sameSource:()=>{},
   identities:['employee_message_original_outcomes','group_original_creations'],witnessKeys:Object.keys(witness),postgresJsonTextLineEncoding:'JSON',postgresTextColumnsLineEncoding:'TEXT',
   readVerifiedPrivateImportSource:()=>original,captureVerifiedImmutableFreshRestoreIntent:()=>({}),readVerifiedImmutableFreshRestoreIntent:()=>captured,requireLegacyOriginalDataFidelity:async()=>{},
   initializeVerifiedImmutableFreshSource:async()=>{enter('initialize');return {schema:'custodial.immutable-private-source-initialized.v1',initialized_source_only:true,transaction_authority:false,restore_complete:false,admission_resumed:false,guard_recipes:25,source_statements:13,authority_scope_functions:6,...witness};},
   prepareVerifiedImmutableFreshRestoreControl:async()=>{enter('control');return witness;},capturePreRestoreState:async()=>{enter('snapshot');},stageVerifiedImmutablePrivateData:async()=>{enter('import');}};
  const fn=new Function(...Object.keys(deps),body+';return stageVerifiedImmutableFreshData;')(...Object.values(deps));
  await assert.rejects(fn({db,verifiedArchive:archive,originalIntentEnvelope:{},intentVerifyKey:'unit',intentVerifyKeyId:'unit'}),e=>e===error);
  assert.equal(calls.at(-1),failed);assert.deepEqual(readImmutableFreshFailure(error),{fresh_stage:phase});
 }
});
