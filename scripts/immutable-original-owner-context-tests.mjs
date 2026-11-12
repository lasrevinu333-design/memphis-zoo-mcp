import {recordImmutableFreshFailure,readImmutableFreshFailure} from './immutable-private-stage-diagnostic.mjs';
// Exact shipping closures with inert recording clients. These tests prove
// actor plumbing/refusal order only; they do not assert native SQL admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {types,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
const text=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const load=(file,deps,result)=>{deps={recordImmutableFreshFailure,...deps};return new Function(...Object.keys(deps),text(file)
 .replace(/^import\s[\s\S]*?;\n/gm,'').replaceAll('export async function','async function')+'\nreturn '+result+';')(...Object.values(deps));};
const profiles=[
 Object.freeze({id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'}),
 Object.freeze({id:'immutable-private-current-postgres',actor:'postgres'}),
];
const checkpoint=new Error('INERT_NATIVE_CHECKPOINT');
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
