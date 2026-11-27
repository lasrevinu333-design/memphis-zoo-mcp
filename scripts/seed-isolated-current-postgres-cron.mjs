// Disposable backup-only SCHEMA SETUP, never a production restore authority.
// Parent owns and repeatedly verifies the exact private container/network/relay.
import assert from 'node:assert/strict';
import {isDeepStrictEqual,types} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {materializeVerifiedArchive} from './disaster-recovery-archive.mjs';
import {requireSigningKey} from './disaster-recovery-crypto.mjs';
import {prepareVerifiedImmutableBootstrapSource,assertVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapOwnerProfile} from './immutable-private-source-bootstrap.mjs';
import {restoreCronJobs,verifyRestoredCronJobs} from './disaster-recovery-cron.mjs';

const stages=new Set(['SOURCE','TARGET','CONNECT','BEGIN','IDENTITY','PRISTINE','RESTORE_CRON','VERIFY_CRON','COMMIT','READBACK','CLEANUP']);
const codes=new Set(['08000','08001','08003','08006','08P01','22023','23503','23505','23514','25000','25006','25P02','42501','42601','42703','42883','42P01','55000','57014','57P01','XX000']);
const own=(v,k)=>{if(!v||typeof v!=='object'||types.isProxy(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
export function cronSetupFailure(error,stage){return Object.freeze({schema:'custodial.isolated-current-postgres-cron-setup-failure.v1',ok:false,
 stage:stages.has(stage)?stage:'CLEANUP',...(codes.has(own(error,'code'))?{sql_state:own(error,'code')}:{}),private_payload_exported:false,production_written:false});}
export function projectCronSetupFailure(value){
 if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.some(k=>!['schema','ok','stage','sql_state','private_payload_exported','production_written'].includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))return null;
 const data=Object.fromEntries(keys.map(k=>[k,d[k].value]));
 const projected=cronSetupFailure({code:data.sql_state},data.stage);return isDeepStrictEqual(projected,data)?projected:null;
}
const contextSql=`select current_user actor,session_user session_actor,current_database() database,
 (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
 pg_backend_pid() pid,pg_catalog.txid_current()::text xid,
 current_setting('transaction_read_only') readonly,current_setting('session_replication_role') replication,
 current_setting('cron.launch_active_jobs',true) cron_execution,
 (select rolsuper from pg_catalog.pg_roles where rolname=current_user) administrator`;
const schemas=new Set(['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private']);
const quote=v=>{assert.equal(typeof v,'string');assert.ok(v.length>0&&!v.includes('\0')&&Buffer.byteLength(v)<=63);return '"'+v.replaceAll('"','""')+'"';};
export async function seedIsolatedCurrentPostgresCron({verifiedArchive,connectionString,runId}){
 let stage='SOURCE',db,active=false,committed=false,readback=false,failure,latch,identity,readbackIdentity,result;
 const source=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);
 const current=()=>{assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
  assert.deepEqual(readVerifiedImmutableBootstrapOwnerProfile(source,verifiedArchive),{id:'immutable-private-current-postgres',actor:'postgres'});
  if(latch)throw latch;};
 current();stage='TARGET';assert.match(runId,/^[1-9][0-9]*$/);
 const expected='mz_schema_rebuild_'+runId,url=new URL(connectionString);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(decodeURIComponent(url.pathname),'/'+expected);
 assert.equal(decodeURIComponent(url.username),'supabase_admin');assert.equal(url.protocol,'postgresql:');
 // node-postgres also interprets query parameters as connection settings.
 assert.equal(url.search,'','Owned relay URL cannot contain connection overrides');
 assert.equal(url.hash,'','Owned relay URL cannot contain a fragment');
 assert.match(url.port,/^[1-9][0-9]*$/,'Owning factory must supply the explicit relay port');
 const inventory=JSON.parse(source.inventory['inventory/original-relations.json']);assert.ok(Array.isArray(inventory)&&inventory.length>0);
 const seen=new Set(),counts=inventory.map(row=>{assert.ok(schemas.has(row.schema_name));assert.equal(row.relation_kind,'r');assert.equal(row.is_partition,false);
  const name=quote(row.schema_name)+'.'+quote(row.table_name);assert.ok(!seen.has(name));seen.add(name);return `select count(*)::bigint n from ${name}`;});
 const cron=JSON.parse(source.inventory['inventory/cron-jobs.json']),sourceDatabase=source.sourceBinding.summary.database_snapshot?.database_name;
 assert.ok(Array.isArray(cron));assert.equal(typeof sourceDatabase,'string');assert.ok(sourceDatabase.length>0);
 const nativeQuery=pg.Client.prototype.query;
 try{
  db=new pg.Client({connectionString,application_name:'custodial-isolated-cron-schema-setup'});
  db.on('error',error=>{latch??=error;});stage='CONNECT';await db.connect();current();
  const raw=async(sql,args=[])=>{current();assert.equal(Object.getPrototypeOf(db),pg.Client.prototype);assert.equal(Object.hasOwn(db,'query'),false);
   assert.equal(pg.Client.prototype.query,nativeQuery);const r=await Reflect.apply(nativeQuery,db,[sql,args]);current();return r;};
  const context=async()=>{const r=await raw(contextSql);assert.equal(r.rowCount,1);const c=r.rows[0];
   assert.equal(c.actor,'supabase_admin');assert.equal(c.session_actor,c.actor);assert.equal(c.database,expected);assert.equal(c.database_owner,'postgres');
   assert.equal(c.readonly,readback?'on':'off');assert.equal(c.replication,'origin');assert.equal(c.cron_execution,'off');assert.equal(c.administrator,true);
   assert.match(c.database_oid,/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(c.pid)&&c.pid>0);assert.match(c.xid,/^[1-9][0-9]*$/);
   if(readback){
    assert.deepEqual({...c,xid:identity.xid,readonly:identity.readonly},identity,'Owned cron readback connection changed');
    if(readbackIdentity)assert.deepEqual(c,readbackIdentity,'Cron readback left its original read-only transaction');else readbackIdentity=Object.freeze({...c});
   }else if(identity)assert.deepEqual(c,identity,'Owned cron setup connection/transaction changed');else identity=Object.freeze({...c});return c;};
  stage='BEGIN';await raw('begin');active=true;await raw("set local search_path=pg_catalog;set local statement_timeout='30s';set local lock_timeout='5s'");
  stage='IDENTITY';await context();
  const query=async(sql,args=[])=>{await context();const r=await raw(sql,args);await context();return r;};
  stage='PRISTINE';const empty=(await query(`select bool_and(n=0) empty from (${counts.join(' union all ')}) original_tables`)).rows;
  assert.deepEqual(empty,[{empty:true}]);
  const extra=(await query(`select (select count(*)::int from cron.job) jobs,
   (select count(*)::int from supabase_migrations.schema_migrations) migrations,
   (select count(*)::int from custodial_dr.restore_control) controls,
   (select count(*)::int from custodial_dr.restore_manifests) manifests,
   (select count(*)::int from custodial_dr.restore_events) events,
   (select count(*)::int from custodial_dr.application_mutation_leases) leases,
   to_regclass('custodial_dr.immutable_private_import_context')::text existing_import`)).rows;
  assert.deepEqual(extra,[{jobs:0,migrations:0,controls:0,manifests:0,events:0,leases:0,existing_import:null}]);
  const port=Object.freeze({query});stage='RESTORE_CRON';const restored=await restoreCronJobs(port,cron,{sourceDatabase,sourceCounter:source.sourceBinding.summary.source_identity?.cron_jobid_counter});assert.equal(restored.differences.length,0);
  stage='VERIFY_CRON';const verified=await verifyRestoredCronJobs(port,cron,{sourceDatabase,sourceCounter:source.sourceBinding.summary.source_identity?.cron_jobid_counter});assert.equal(verified.differences.length,0);
  stage='COMMIT';await raw('commit');active=false;committed=true;
  stage='READBACK';await raw('begin isolation level repeatable read read only');active=true;readback=true;
  await context();const after=await verifyRestoredCronJobs(port,cron,{sourceDatabase,sourceCounter:source.sourceBinding.summary.source_identity?.cron_jobid_counter});assert.equal(after.differences.length,0);
  // Read-only completion is one ROLLBACK, never a retry after an uncertain end.
  active=false;await raw('rollback');
  result={schema:'custodial.isolated-current-postgres-cron-setup.v1',ok:true,jobs:cron.length,rows_and_counter_verified:true,
   committed:true,application_data_written:false,owners_or_grants_changed:false,cron_execution_enabled:false,production_written:false,restore_admission:false};
 }catch(error){failure=error;}
 finally{
  if(!failure)stage='CLEANUP';
  if(active&&db&&!latch)try{current();await Reflect.apply(nativeQuery,db,['rollback']);active=false;}catch(error){failure??=error;}
  if(db)try{await db.end();}catch(error){failure??=error;}
  if(latch)failure??=latch;
  try{current();}catch(error){failure??=error;}
 }
 if(failure){const receipt=cronSetupFailure(failure,stage);const error=new Error('Isolated cron schema setup refused; private payload withheld.');Object.defineProperty(error,'cron_setup_failure',{value:receipt});throw error;}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let archive;
 try{
  assert.equal(process.argv.length,2);assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER,'true');
  archive=materializeVerifiedArchive({sourceDir:process.env.RESTORE_SOURCE_DIR,
   archiveVerifyKey:requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),archiveVerifyKeyId:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,
   supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/original-relations.json','inventory/cron-jobs.json']});
  console.log(JSON.stringify(await seedIsolatedCurrentPostgresCron({verifiedArchive:archive,connectionString:process.env.SUPABASE_DB_URL,runId:process.env.GITHUB_RUN_ID})));
 }catch(error){console.log(JSON.stringify(own(error,'cron_setup_failure')??cronSetupFailure(error,'SOURCE')));process.exitCode=1;}
 finally{try{archive?.cleanup();}catch(error){console.log(JSON.stringify(cronSetupFailure(error,'CLEANUP')));process.exitCode=1;}}
}
