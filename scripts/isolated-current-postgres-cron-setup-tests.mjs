import {recordImmutableFreshProgress} from './immutable-private-stage-diagnostic.mjs';
// Actual owning function bodies with inert recording connections/Source ports.
// No cryptographic Source admission, PostgreSQL, Docker or restore is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {types} from 'node:util';
import {cronSetupFailure,projectCronSetupFailure} from './seed-isolated-current-postgres-cron.mjs';
const source=readFileSync(new URL('./seed-isolated-current-postgres-cron.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function seedIsolatedCurrentPostgresCron'),source.indexOf('\nif(process.argv[1]')).replace('export async function','async function');
const contextSql=source.match(/const contextSql=`([\s\S]*?)`;/)[1];
function fixture(mode='ok'){
 const calls=[],archive={},state={connected:0,ended:0,restored:0,verified:0,withdrawn:false,committed:false,readOnly:false,readbackContexts:0};
 const cron=[{jobid:'5',schedule:'* * * * *',command:'PRIVATE COMMAND',database:'postgres',username:'postgres',nodename:'localhost',nodeport:5432,active:true,jobname:'PRIVATE NAME'}];
 const original={inventory:{'inventory/original-relations.json':JSON.stringify([{schema_name:'public',table_name:'fixture',relation_kind:'r',is_partition:false}]),'inventory/cron-jobs.json':JSON.stringify(cron)},sourceBinding:{summary:{database_snapshot:{database_name:'postgres'}}}};
 const error=()=>Object.assign(new Error('PRIVATE SQL ROW AND SECRET'),{code:'08006'});
 class Native extends EventEmitter{
  constructor(options){super();this.connectionParameters={host:'127.0.0.1',database:'mz_schema_rebuild_123'};calls.push('construct');}
  async connect(){assert.equal(this.listenerCount('error'),1);state.connected++;if(mode==='connect')throw error();}
  async query(sql,args=[]){calls.push(sql);
   if(sql==='begin isolation level repeatable read read only')state.readOnly=true;
   if(sql===contextSql){if(mode==='idle'){this.emit('error',error());}
    if(mode==='withdraw')state.withdrawn=true;
    if(state.readOnly)state.readbackContexts++;
    return{rowCount:1,rows:[{actor:mode==='actor'?'postgres':'supabase_admin',session_actor:'supabase_admin',database:'mz_schema_rebuild_123',database_oid:'4',database_owner:'postgres',
     pid:mode==='identity'&&state.restored?999:22,xid:mode==='readback_drift'&&state.readbackContexts>1?'103':state.committed?'102':'101',readonly:state.readOnly?'on':'off',replication:mode==='replication'?'replica':'origin',cron_execution:mode==='execution'?'on':'off',administrator:mode!=='administrator'}]};}
   if(sql.startsWith('select bool_and'))return{rows:[{empty:mode!=='application_rows'}]};
   if(sql.startsWith('select (select count'))return{rows:[{jobs:mode==='existing_jobs'?1:0,migrations:mode==='existing_ledger'?1:0,controls:0,manifests:0,events:0,leases:mode==='lease'?1:0,existing_import:null}]};
   if(sql==='commit'){if(mode==='commit')throw error();state.committed=true;}
   return{rows:[],rowCount:0};
  }
  async end(){state.ended++;if(mode==='end')throw error();}
 }
 const current=()=>{if(state.withdrawn)throw error();};
 const deps={assert,pg:{Client:Native},types,contextSql,schemas:new Set(['public']),quote:v=>'"'+v+'"',cronSetupFailure,
  prepareVerifiedImmutableBootstrapSource:async supplied=>{assert.equal(supplied,archive);return original;},
  assertVerifiedImmutableBootstrapSource:current,
  readVerifiedImmutableBootstrapOwnerProfile:()=>({id:'immutable-private-current-postgres',actor:mode==='profile'?'supabase_admin':'postgres'}),
  restoreCronJobs:async(port,jobs,options)=>{state.restored++;assert.deepEqual(jobs,cron);assert.deepEqual(options,{sourceDatabase:'postgres'});
   await port.query('alter sequence "cron"."jobid_seq" restart');await port.query('truncate cron.job restart identity');await port.query('insert into cron.job values ($1)',['PRIVATE SIGNED ROW']);
   return{differences:[],target_database:'mz_schema_rebuild_123'};},
  verifyRestoredCronJobs:async(port,jobs)=>{state.verified++;assert.deepEqual(jobs,cron);await port.query('select exact_cron_rows_and_counter');return{differences:mode==='counter'||mode==='readback'&&state.committed?[{}]:[]};}};
 const fn=new Function(...Object.keys(deps),body+';return seedIsolatedCurrentPostgresCron;')(...Object.values(deps));
 const run=(changes={})=>fn({verifiedArchive:archive,connectionString:'postgresql://supabase_admin:postgres@127.0.0.1:43210/mz_schema_rebuild_123',runId:'123',...changes});
 return{run,calls,state};
}
test('isolated cron setup owns its native connection and keeps original application/permission effects absent',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.ok,true);assert.equal(result.rows_and_counter_verified,true);assert.equal(result.jobs,1);
 assert.equal(result.application_data_written,false);assert.equal(result.owners_or_grants_changed,false);assert.equal(result.restore_admission,false);
 assert.equal(f.state.connected,1);assert.equal(f.state.ended,1);assert.equal(f.state.restored,1);assert.equal(f.state.verified,2);
 assert.equal(f.calls.filter(s=>s==='commit').length,1);assert.equal(f.calls.filter(s=>s==='rollback').length,1);
 assert.ok(f.calls.indexOf('begin isolation level repeatable read read only')>f.calls.indexOf('commit'));
 assert.ok(f.calls.indexOf('begin')<f.calls.indexOf(contextSql));assert.ok(f.calls.some(s=>s.startsWith('select bool_and')));
 assert.ok(f.calls.indexOf('commit')>f.calls.indexOf('insert into cron.job values ($1)'));
 assert.ok(!f.calls.some(s=>/^(?:grant|revoke|alter role|set role|set session authorization)/i.test(s)));
});
for(const mode of ['actor','replication','execution','administrator','application_rows','existing_jobs','existing_ledger','lease','connect','idle','withdraw','profile'])
 test('cron setup refuses '+mode+' before any cron write and closes its connection',async()=>{
  const f=fixture(mode);await assert.rejects(f.run());assert.equal(f.state.restored,0);assert.equal(f.calls.includes('commit'),false);
  assert.equal(f.state.ended,mode==='profile'?0:1);assert.equal(f.state.connected,mode==='profile'?0:1);
 });
for(const [name,changes]of [['remote',{connectionString:'postgresql://supabase_admin:postgres@example.invalid/mz_schema_rebuild_123'}],
 ['production',{connectionString:'postgresql://supabase_admin:postgres@127.0.0.1/postgres'}],['wrong run',{runId:'124'}],['wrong actor URL',{connectionString:'postgresql://postgres:postgres@127.0.0.1/mz_schema_rebuild_123'}]])
 test('cron setup rejects '+name+' without connecting',async()=>{const f=fixture();await assert.rejects(f.run(changes));assert.equal(f.state.connected,0);assert.equal(f.state.restored,0);});
for(const mode of ['identity','counter','commit','readback','readback_drift','end'])test('cron '+mode+' failure is never a successful or retried setup',async()=>{
 const f=fixture(mode);await assert.rejects(f.run(),error=>{const result=Object.getOwnPropertyDescriptor(error,'cron_setup_failure')?.value;
  assert.equal(result.ok,false);assert.equal(result.private_payload_exported,false);assert.equal(result.production_written,false);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|COMMAND|password/);return true;});
 assert.equal(f.state.connected,1);assert.equal(f.state.restored,1);assert.equal(f.state.ended,1);assert.ok(f.calls.filter(s=>s==='commit').length<=1);
});
test('cron setup failure projection rejects unknown keys, values, proxies and accessors without executing them',()=>{
 const receipt=cronSetupFailure({code:'42501',message:'PRIVATE SQL'},'RESTORE_CRON');assert.deepEqual(projectCronSetupFailure(receipt),receipt);
 for(const value of [{...receipt,sql:'PRIVATE'}, {...receipt,stage:'PRIVATE'}, {...receipt,sql_state:'SECRET'}, {...receipt,ok:true},new Proxy(receipt,{})])assert.equal(projectCronSetupFailure(value),null);
 let traps=0;const getter={};Object.defineProperty(getter,'schema',{enumerable:true,get(){traps++;return 'SECRET';}});assert.equal(projectCronSetupFailure(getter),null);assert.equal(traps,0);
});

const initializer=readFileSync(new URL('./immutable-private-source-initializer.mjs',import.meta.url),'utf8');
const start=initializer.indexOf(' const parameters=Object.getOwnPropertyDescriptor'),end=initializer.indexOf(" initializerStage='INITIALIZE_CONTROL';",start);
assert.ok(start>0&&end>start);const preseedBody=initializer.slice(start,end);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function preseed({profile='immutable-private-current-postgres',host='127.0.0.1',database='mz_schema_rebuild_123',execution='off',difference=false,jobs=1}={}){
 let verifies=0;const source={sourceBinding:{summary:{database_snapshot:{database_name:'postgres'}}}},cron=[{synthetic:true}],db={connectionParameters:{host,database}};
 const deps={recordImmutableFreshProgress,assert,types,db,ownerProfile:{id:profile},originalContext:{database},source,
  query:async sql=>({rows:sql.includes('cron_execution')?[{cron_execution:execution}]:[{controls:0,manifests:0,events:0,migrations:0,jobs,existing_import:null}]}),
  inventory:()=>cron,verifyRestoredCronJobs:async()=>{verifies++;return{target_database:database,differences:difference?[{}]:[]};},checkSource(){},readContext:async()=>{}};
 const result=await new AsyncFunction(...Object.keys(deps),"let initializerStage='VERIFY_EMPTY_RELATIONS';"+preseedBody+'return{seededIsolatedCron,initializerStage};')(...Object.values(deps));return{...result,verifies};
}
test('original initializer verifies exact signed seeded cron before its first control effect',async()=>{
 assert.equal((await preseed()).verifies,1);
 for(const options of [{execution:'on'},{difference:true},{jobs:2},{host:'example.invalid'},{database:'postgres'},{profile:'immutable-private-legacy-supabase-admin'}])await assert.rejects(preseed(options));
 const legacy=await preseed({profile:'immutable-private-legacy-supabase-admin',jobs:0});assert.equal(legacy.seededIsolatedCron,false);assert.equal(legacy.verifies,0);
 assert.match(initializer,/const restoredCron=seededIsolatedCron\?await verifyRestoredCronJobs[\s\S]*?:await restoreCronJobs/);
});
