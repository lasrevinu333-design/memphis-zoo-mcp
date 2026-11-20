// One original disposable current-schema context measurement. Always rollback.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {materializeVerifiedArchive,readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';
import {requireSigningKey} from './disaster-recovery-crypto.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {diagnoseVerifiedImmutableFreshContextCost} from './immutable-private-data-import.mjs';
import {readVerifiedCurrent428ForwardQualificationSource} from './current428-forward-qualification-source.mjs';
import {selectPrivateContextCostMode,projectPrivateContextCost,projectPrivateContextCostFailure} from './private-context-cost-observer.mjs';
const Client=pg.Client,nativeQuery=Client.prototype.query,nativeEnd=Client.prototype.end;
export async function observePrivateContextCost(env=process.env){
 assert.equal(selectPrivateContextCostMode(env.PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY,env.REHEARSAL_SCOPE,env.OFFICIAL_LOCAL_STORAGE_PROVIDER),true);
 assert.equal(env.RESTORE_APPLY,'true');assert.equal(env.RESTORE_DATABASE_ONLY,'true');assert.match(env.GITHUB_RUN_ID,/^[1-9][0-9]*$/);
 const url=new URL(env.SUPABASE_DB_URL);assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'postgres');
 assert.equal(url.pathname,'/mz_schema_rebuild_'+env.GITHUB_RUN_ID);assert.equal(url.search,'');assert.equal(url.hash,'');assert.match(url.port,/^[1-9][0-9]{0,4}$/);
 let archive,db,began=false,receipt,failure,closed=false,current428=false,phase='SOURCE_ADMISSION',rollbackReceived=false,readbackVerified=false;
 try{
  archive=materializeVerifiedArchive({sourceDir:env.RESTORE_SOURCE_DIR,archiveVerifyKey:requireSigningKey(env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),
   archiveVerifyKeyId:env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json']});
  const original=readVerifiedPrivateImportSource(archive);assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),{id:'immutable-private-current-postgres',actor:'postgres'});
  try{const source=readVerifiedCurrent428ForwardQualificationSource(archive);source.assertCurrent();current428=true;}catch{}
  phase='NATIVE_CONTROL';db=new Client({connectionString:env.SUPABASE_DB_URL,application_name:'memphis-zoo-private-context-cost-only',connectionTimeoutMillis:10000,statement_timeout:120000,query_timeout:125000});
  assert.equal(Object.getPrototypeOf(db),Client.prototype);assert.equal(Object.hasOwn(db,'query'),false);assert.equal(Client.prototype.query,nativeQuery);
  await db.connect();const query=(sql,args=[])=>Reflect.apply(nativeQuery,db,[sql,args]);
  await query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
  await query('BEGIN');began=true;await query('SET LOCAL search_path=pg_catalog');
  await query("set local extra_float_digits = 3;set local datestyle = 'ISO, YMD';set local timezone = 'UTC';set local intervalstyle = 'postgres';set local bytea_output = 'hex'");
  await query('SET LOCAL row_security=off');
  await query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
  await query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
  phase='MEASURE_CONTEXT';receipt=await diagnoseVerifiedImmutableFreshContextCost({db,verifiedArchive:archive,originalIntentEnvelope:JSON.parse(env.RESTORE_INTENT_JSON),
   intentVerifyKey:env.RESTORE_INTENT_VERIFY_KEY,intentVerifyKeyId:env.RESTORE_INTENT_VERIFY_KEY_ID});
  assert.equal(receipt.archive_digest,original.sourceBinding.archive_digest);
  phase='ROLLBACK';const rollback=await query('ROLLBACK');assert.equal(rollback.command,'ROLLBACK');began=false;rollbackReceived=true;
  phase='ROLLBACK_READBACK';await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;await query('SET LOCAL row_security=off');
  const readback=await query(`select current_user actor,session_user session_actor,current_database() database,
   (select rolsuper from pg_roles where rolname=current_user) superuser,current_setting('transaction_read_only') readonly,
   to_regclass('custodial_dr.immutable_private_import_context') is null context_absent,
   (select count(*)::text from public.employees) employee_rows,
   (select count(*)::text from custodial_release_identity.group_original_creations) group_original_rows,
   (select count(*)::text from custodial_release_identity.employee_message_original_outcomes) message_original_rows,
   (select count(*)::text from custodial_dr.restore_control) controls,
   (select count(*)::text from public.release_deployment_manifest) releases,
   (select count(*)::text from public.custodial_release_authority_restore_inventory) registry`);
  assert.equal(readback.rowCount,1);assert.deepEqual(readback.rows[0],{actor:'postgres',session_actor:'postgres',database:'mz_schema_rebuild_'+env.GITHUB_RUN_ID,
   superuser:false,readonly:'on',context_absent:true,employee_rows:'0',group_original_rows:'0',message_original_rows:'0',controls:'0',releases:'0',registry:'0'});readbackVerified=true;
  const current=readVerifiedPrivateImportSource(archive);assert.equal(current.sourceBinding,original.sourceBinding);
  assert.deepEqual(current.selection,original.selection);assert.deepEqual(current.privateDataMembers,original.privateDataMembers);
  const final=await query('ROLLBACK');assert.equal(final.command,'ROLLBACK');began=false;
 }catch(error){failure=error;}
 finally{
  if(db&&began)try{const r=await Reflect.apply(nativeQuery,db,['ROLLBACK']);if(r.command==='ROLLBACK')rollbackReceived=true;}catch(error){failure??=error;}
  if(db)try{await Reflect.apply(nativeEnd,db,[]);closed=true;}catch(error){if(!failure)phase='CLOSE';failure??=error;}
  try{archive?.cleanup();}catch(error){failure??=error;}
 }
 if(failure||!receipt||!closed){
  const own=(k)=>failure&&typeof failure==='object'?Object.getOwnPropertyDescriptor(failure,k)?.value:null;
  const code=own('sql_state')??own('code'),probe=own('context_cost_probe')??null;
  const detail=projectPrivateContextCostFailure({schema:'custodial.private-current-context-cost-failure.v1',phase,probe,
   sql_state:typeof code==='string'&&/^[A-Z0-9]{5}$/.test(code)?code:null,rollback_command_received:rollbackReceived,readback_verified:readbackVerified,connection_closed:closed});
  throw Object.assign(new Error('Original context cost observation refused; no DATA restore admission'),{context_cost_failure:detail});
 }
 const result=projectPrivateContextCost({...receipt,rollback_verified:true,readback_connection_closed:true,current428_source_qualified:current428});assert.ok(result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,2);console.log(JSON.stringify(await observePrivateContextCost()));}
 catch(error){
  const detail=projectPrivateContextCostFailure(Object.getOwnPropertyDescriptor(error,'context_cost_failure')?.value)
   ??{schema:'custodial.private-current-context-cost-failure.v1',phase:'SOURCE_ADMISSION',probe:null,sql_state:null,rollback_command_received:false,readback_verified:false,connection_closed:false};
  console.log(JSON.stringify(detail));process.exitCode=1;
 }
}
