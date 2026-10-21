// Original fresh control preparation only. The caller owns the transaction,
// both exclusive application fences, rollback and every later DATA decision.
import assert from 'node:assert/strict';
import {types} from 'node:util';
import pg from 'pg';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';

const Client=pg.Client,prototype=Client.prototype,nativeQuery=prototype.query,attempted=new WeakSet();
function closed(value,keys){
 assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype,'Closed original control DATA required');
 const fields=Object.getOwnPropertyDescriptors(value);assert.deepEqual(Reflect.ownKeys(fields).sort(),keys.slice().sort());
 return Object.fromEntries(keys.map(key=>{const field=fields[key];assert.ok(Object.hasOwn(field,'value')&&field.enumerable,'Original control accessors refused');return[key,field.value];}));
}
function one(result){
 assert.ok(result&&typeof result==='object'&&!types.isProxy(result));
 const count=Object.getOwnPropertyDescriptor(result,'rowCount'),rows=Object.getOwnPropertyDescriptor(result,'rows');
 assert.ok(count&&Object.hasOwn(count,'value')&&count.value===1);assert.ok(rows&&Object.hasOwn(rows,'value'));
 const values=rows.value;assert.ok(Array.isArray(values)&&!types.isProxy(values)&&Object.getPrototypeOf(values)===Array.prototype);
 const fields=Object.getOwnPropertyDescriptors(values);assert.deepEqual(Reflect.ownKeys(fields).sort(),['0','length']);
 assert.equal(fields.length.value,1);assert.ok(Object.hasOwn(fields['0'],'value')&&fields['0'].enumerable);return fields['0'].value;
}
const contextSql=`select
 (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 pg_catalog.pg_backend_pid() backend_pid,pg_catalog.txid_current()::text transaction_id,
 current_user actor,session_user session_actor,
 (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner,
 (select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname='custodial_dr') dr_owner,
 (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=pg_catalog.to_regclass('custodial_dr.restore_control') and relkind='r') control_owner,
 pg_catalog.current_setting('session_replication_role') replication,pg_catalog.current_setting('row_security') row_security,
 pg_catalog.current_setting('search_path') search_path,pg_catalog.current_setting('transaction_read_only') read_only,
 (select count(*)::text from custodial_dr.application_mutation_leases) lease_count,
 (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
  where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
   and l.database=(select oid from pg_catalog.pg_database where datname=current_database()) and l.granted and l.mode='ExclusiveLock'
   and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
   and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences,
 (select count(*)::int from custodial_dr.restore_control) control_count,
 (select pg_catalog.jsonb_build_object('state',state,'authority_generation',authority_generation::text,'mutations_paused',mutations_paused,
   'restore_id',restore_id,'archive_digest',archive_digest,'source_project_ref',source_project_ref,'target_project_ref',target_project_ref,
   'release_identity',release_identity,'started_by',started_by,'started_at',started_at::text,'completed_at',completed_at::text,'failure_reason',failure_reason)
  from custodial_dr.restore_control where singleton) control,
 (select count(*)::int from custodial_dr.restore_manifests) manifest_count,
 (select pg_catalog.jsonb_build_object('restore_id',restore_id,'authority_generation',authority_generation::text,'archive_digest',archive_digest,
   'database_verified',database_verified,'storage_verified',storage_verified,'authority_invalidated',authority_invalidated,
   'post_restore_verified',post_restore_verified,'database_evidence',database_evidence,'storage_evidence',storage_evidence,
   'authority_evidence',authority_evidence,'final_manifest_sha256',final_manifest_sha256) from custodial_dr.restore_manifests) manifest,
 (select count(*)::int from custodial_dr.restore_events) events_count`;

export async function prepareVerifiedImmutableFreshRestoreControl(options){
 const {db,verifiedArchive,freshIntent}=closed(options,['db','verifiedArchive','freshIntent']);
 const native=()=>assert.ok(db&&typeof db==='object'&&!types.isProxy(db)&&Client.prototype===prototype
  &&Object.getPrototypeOf(db)===prototype&&!Object.hasOwn(db,'query')&&prototype.query===nativeQuery,'Actual original native pg.Client required');
 native();assert.ok(!attempted.has(db),'Original fresh control attempt already consumed');attempted.add(db);
 const original=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
 const {intent,sourceBinding}=closed(original,['intent','envelope','sourceBinding']);
 assert.equal(intent.authority_generation,1);assert.equal(intent.retry_of_restore_id,null);assert.equal(intent.resume_after_verification,false);
 const current=()=>{
  native();const live=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
  assert.ok(live.intent===original.intent&&live.envelope===original.envelope&&live.sourceBinding===sourceBinding,'Original fresh intent/source changed');
 };
 const releaseIdentity={archive:sourceBinding.source_identity.release,target:intent.target_release_identity,retry_of_restore_id:null};
 const ready={state:'READY',authority_generation:'0',mutations_paused:false,restore_id:null,archive_digest:null,
  source_project_ref:null,target_project_ref:null,release_identity:{},started_by:null,started_at:null,completed_at:null,failure_reason:null};
 let originalContext,originalStarted;
 const raw=async(sql,args=[])=>{
  current();let value,failed=false,failure;
  try{value=await Reflect.apply(nativeQuery,db,[sql,args]);}catch(error){failed=true;failure=error;}
  try{current();}catch(error){if(failed)throw new AggregateError([failure,error],'Original control operation/currentness refused',{cause:failure});throw error;}
  if(failed)throw failure;return value;
 };
 const context=async phase=>{
  const row=closed(one(await raw(contextSql)),['database_oid','backend_pid','transaction_id','actor','session_actor','database_owner','dr_owner',
   'control_owner','replication','row_security','search_path','read_only','lease_count','held_fences','control_count','control','manifest_count','manifest','events_count']);
  assert.equal(typeof row.database_oid,'string');assert.match(row.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);assert.ok(BigInt(row.database_oid)<=4294967295n);
  assert.ok(Number.isSafeInteger(row.backend_pid)&&row.backend_pid>0&&row.backend_pid<=2147483647);
  assert.equal(typeof row.transaction_id,'string');assert.match(row.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);assert.ok(BigInt(row.transaction_id)<=9223372036854775807n);
  const stable={database_oid:row.database_oid,backend_pid:row.backend_pid,transaction_id:row.transaction_id};
  if(originalContext)assert.deepEqual(stable,originalContext,'Original control database/backend/transaction changed');
  assert.equal(row.actor,'supabase_admin');assert.equal(row.session_actor,row.actor);assert.equal(row.database_owner,'postgres');
  assert.equal(row.dr_owner,'postgres');assert.equal(row.control_owner,'supabase_admin');
  assert.equal(row.replication,'origin');assert.equal(row.row_security,'off');assert.equal(row.search_path,'pg_catalog');assert.equal(row.read_only,'off');
  assert.equal(row.lease_count,'0');assert.equal(row.held_fences,2);assert.equal(row.control_count,1);assert.equal(row.events_count,0);
  const control=closed(row.control,Object.keys(ready));
  if(phase==='READY')assert.deepEqual(control,ready,'Original READY0 control required');
  else{
   assert.ok(phase==='PAUSED'||phase==='PREPARED');
   assert.equal(typeof control.started_at,'string');assert.ok(control.started_at.length>0);
   if(originalStarted!==undefined)assert.equal(control.started_at,originalStarted,'Original control start changed');
   assert.deepEqual(control,{state:'PREPARING',authority_generation:'1',mutations_paused:true,restore_id:intent.restore_id,
    archive_digest:intent.archive_digest,source_project_ref:sourceBinding.project_ref,target_project_ref:intent.target_project_ref,
    release_identity:releaseIdentity,started_by:intent.actor,started_at:control.started_at,completed_at:null,failure_reason:null});
  }
  if(phase==='PREPARED'){
   assert.equal(row.manifest_count,1);
   assert.deepEqual(row.manifest,{restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest,
    database_verified:false,storage_verified:false,authority_invalidated:false,post_restore_verified:false,
    database_evidence:{},storage_evidence:{},authority_evidence:{},final_manifest_sha256:null});
  }else{assert.equal(row.manifest_count,0);assert.equal(row.manifest,null);}
  return {stable,control};
 };
 // A second actual read must observe the SAME xid; autocommit cannot qualify.
 originalContext=Object.freeze((await context('READY')).stable);await context('READY');
 const query=async(sql,args,before,after=before)=>{
  await context(before);let result,failed=false,failure;
  try{result=await raw(sql,args);}catch(error){failed=true;failure=error;}
  let checked;
  try{checked=await context(after);}catch(error){if(failed)throw new AggregateError([failure,error],'Original control operation/context refused',{cause:failure});throw error;}
  if(failed)throw failure;return {result,checked};
 };
 const locked=await query(`select state,authority_generation::text authority_generation,mutations_paused,restore_id,archive_digest,
  source_project_ref,target_project_ref,release_identity,started_by,started_at::text started_at,completed_at::text completed_at,failure_reason
  from custodial_dr.restore_control where singleton=true for update`,[],'READY');
 assert.deepEqual(one(locked.result),ready,'Exact original singleton must remain READY0 under its row lock');
 const migration=await query('select max(version)::text migration_head from supabase_migrations.schema_migrations',[],'READY');
 assert.deepEqual(closed(one(migration.result),['migration_head']),{migration_head:intent.target_migration_head});
 const release=await query(`select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256
  from public.release_deployment_manifest where status='deployed'
  order by deployed_at desc nulls last,created_at desc,release_id`,[],'READY');
 assert.deepEqual(closed(one(release.result),['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256']),intent.target_release_identity);
 const paused=await query(`update custodial_dr.restore_control set authority_generation=1,mutations_paused=true,state='PREPARING',
  restore_id=$1::uuid,archive_digest=$2::text,source_project_ref=$3::text,target_project_ref=$4::text,
  release_identity=$5::jsonb,started_by=$6::text,started_at=clock_timestamp(),completed_at=null,failure_reason=null,updated_at=clock_timestamp()
  where singleton=true and state='READY' and not mutations_paused and authority_generation=0 and restore_id is null and archive_digest is null
  returning started_at::text started_at`,
  [intent.restore_id,intent.archive_digest,sourceBinding.project_ref,intent.target_project_ref,JSON.stringify(releaseIdentity),intent.actor],'READY','PAUSED');
 const start=closed(one(paused.result),['started_at']);assert.equal(start.started_at,paused.checked.control.started_at);originalStarted=start.started_at;
 const manifest=await query(`insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest)
  values($1::uuid,1,$2::text) returning restore_id::text restore_id,authority_generation::text authority_generation,archive_digest`,
  [intent.restore_id,intent.archive_digest],'PAUSED','PREPARED');
 assert.deepEqual(closed(one(manifest.result),['restore_id','authority_generation','archive_digest']),
  {restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest});
 await context('PREPARED');current();
 return Object.freeze({...originalContext,restore_id:intent.restore_id,authority_generation:'1',archive_digest:intent.archive_digest});
}
