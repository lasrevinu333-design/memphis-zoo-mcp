// Read only the caller's actual FINISHED import transaction. Neither a public
// receipt nor an earlier Source read is commit/metadata-write authority.
import assert from 'node:assert/strict';
import {types} from 'node:util';
import pg from 'pg';
import {readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {buildVerifiedImmutableFreshDatabaseEvidence} from './immutable-private-fresh-restore-evidence.mjs';

const Client=pg.Client,prototype=Client.prototype,nativeQuery=prototype.query;
const witnessKeys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest'];
function closed(value,keys){
  assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(descriptors).sort(),keys.slice().sort());
  return Object.fromEntries(keys.map(key=>{const field=descriptors[key];assert.ok(Object.hasOwn(field,'value')&&field.enumerable);return[key,field.value];}));
}
function one(result){
  assert.ok(result&&typeof result==='object'&&!types.isProxy(result));
  const count=Object.getOwnPropertyDescriptor(result,'rowCount'),rows=Object.getOwnPropertyDescriptor(result,'rows');
  assert.ok(count&&Object.hasOwn(count,'value')&&count.value===1&&rows&&Object.hasOwn(rows,'value'));
  const values=rows.value;assert.ok(Array.isArray(values)&&!types.isProxy(values)&&Object.getPrototypeOf(values)===Array.prototype);
  const descriptors=Object.getOwnPropertyDescriptors(values);assert.deepEqual(Reflect.ownKeys(descriptors).sort(),['0','length']);
  assert.equal(descriptors.length.value,1);assert.ok(Object.hasOwn(descriptors['0'],'value')&&descriptors['0'].enumerable);
  return descriptors['0'].value;
}
const fenceSql=`with owner_guard as materialized(select custodial_dr.immutable_import_owner_fence())
 select (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 pg_catalog.pg_backend_pid() backend_pid,pg_catalog.txid_current()::text transaction_id from owner_guard`;
const contextSql=`select
 current_user actor,session_user session_actor,
 pg_catalog.current_setting('transaction_read_only') read_only,
 pg_catalog.current_setting('row_security') row_security,
 pg_catalog.current_setting('session_replication_role') replication,
 pg_catalog.current_setting('search_path') search_path,
 (select count(*)::int from custodial_dr.immutable_private_import_context) context_count,
 (select pg_catalog.jsonb_build_object('database_oid',c.database_oid::text,'backend_pid',c.backend_pid,
   'transaction_id',c.transaction_id::text,'restore_id',c.restore_id,'authority_generation',c.authority_generation::text,
   'archive_digest',c.archive_digest,'phase',c.phase,'active_table_oid',c.active_table_oid,
   'active_row_sha256',c.active_row_sha256,'original_manifest',c.original_manifest,'original_control',c.original_control,
   'shape_matches',c.target_shape is not distinct from custodial_dr.immutable_import_target_shape(),
   'unexpired',(c.original_manifest->>'expires_at')::timestamptz>clock_timestamp(),
   'private_rows',(select count(*)::text from custodial_dr.immutable_private_import_rows r
     where r.database_oid=c.database_oid and r.backend_pid=c.backend_pid and r.transaction_id=c.transaction_id))
  from custodial_dr.immutable_private_import_context c
  where c.database_oid=(select oid from pg_catalog.pg_database where datname=current_database())
   and c.backend_pid=pg_catalog.pg_backend_pid() and c.transaction_id=pg_catalog.txid_current()) import_context,
 (select count(*)::int from custodial_dr.restore_control) control_count,
 (select to_jsonb(c) from custodial_dr.restore_control c where singleton) control,
 (select count(*)::int from custodial_dr.restore_manifests) manifest_count,
 (select pg_catalog.jsonb_build_object('restore_id',m.restore_id,'authority_generation',m.authority_generation::text,
   'archive_digest',m.archive_digest,'database_verified',m.database_verified,'storage_verified',m.storage_verified,
   'authority_invalidated',m.authority_invalidated,'post_restore_verified',m.post_restore_verified,
   'database_evidence',m.database_evidence,'storage_evidence',m.storage_evidence,'authority_evidence',m.authority_evidence,
   'final_manifest_sha256',m.final_manifest_sha256,'reconciliation_manifest_sha256',m.reconciliation_manifest_sha256)
  from custodial_dr.restore_manifests m) manifest,
 (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('restore_id',e.restore_id,
   'authority_generation',e.authority_generation::text,'phase',e.phase,'outcome',e.outcome,
   'actor',e.actor,'evidence_json',e.evidence_json) order by e.event_id),'[]'::jsonb)
  from custodial_dr.restore_events e) events`;

// Separate fixed next-transaction observations. The existing Source inventory
// helper requires the caller's already-held inventory SHARE (or stronger) lock;
// nothing here acquires it, renews a context, or adopts a changed rowset.
const postDatabaseFenceSql=`with owner_guard as materialized(select custodial_dr.immutable_import_owner_fence())
 select (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 pg_catalog.pg_backend_pid() backend_pid,pg_catalog.txid_current()::text transaction_id,
 pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
 pg_catalog.current_setting('search_path') search_path,(pg_catalog.current_schemas(true))[1] first_schema,
 (select count(*)::int from unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
  where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
   and l.database=(select oid from pg_catalog.pg_database where datname=current_database()) and l.granted and l.mode='ExclusiveLock'
   and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
   and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)) held_fences,
 custodial_dr.immutable_import_source_inventory_state() recovery_inventory from owner_guard`;
const postDatabaseContextSql=`with fresh_target as materialized(select custodial_dr.immutable_import_target_shape() shape) `+contextSql
 .replace("pg_catalog.current_setting('search_path') search_path,",
  "pg_catalog.current_setting('search_path') search_path,(pg_catalog.current_schemas(true))[1] first_schema,")
 .replace("pg_catalog.current_setting('transaction_read_only') read_only,",
  "pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,")
 .replace("'shape_matches',c.target_shape is not distinct from custodial_dr.immutable_import_target_shape(),",
  "'shape_matches',(c.target_shape-'recovery_inventory') is not distinct from ((select shape from fresh_target)-'recovery_inventory'),\n   'original_inventory',c.target_shape->'recovery_inventory','current_inventory',(select shape->'recovery_inventory' from fresh_target),")
 .replace('and c.transaction_id=pg_catalog.txid_current()', 'and c.transaction_id=$1::bigint');
function decimal(value,positive,max=9223372036854775807n){
 assert.equal(typeof value,'string');assert.ok(value.length<=19);
 assert.match(value,positive?/^[1-9][0-9]*(?![\s\S])/:/^(0|[1-9][0-9]*)(?![\s\S])/);assert.ok(BigInt(value)<=max);
}
function priorFinished(value){
 const prior=closed(value,[...witnessKeys,'private_rows','transaction_authority','admission_resumed']);
 decimal(prior.database_oid,true,4294967295n);decimal(prior.transaction_id,true);decimal(prior.authority_generation,true);decimal(prior.private_rows,false);
 assert.ok(Number.isInteger(prior.backend_pid)&&prior.backend_pid>0&&prior.backend_pid<=2147483647);
 assert.equal(typeof prior.restore_id,'string');assert.match(prior.restore_id,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\s\S])/);
 assert.equal(typeof prior.archive_digest,'string');assert.match(prior.archive_digest,/^[0-9a-f]{64}(?![\s\S])/);
 assert.equal(prior.transaction_authority,false);assert.equal(prior.admission_resumed,false);return Object.freeze(prior);
}
function postDatabaseInventory(value,current){
 const inventory=closed(value,['relation','relation_oid','row_count','canonical_rowset_sha256','epoch']);
 assert.equal(inventory.relation,'public.custodial_release_authority_restore_inventory');decimal(inventory.relation_oid,true,4294967295n);
 decimal(inventory.row_count,true);assert.equal(typeof inventory.canonical_rowset_sha256,'string');assert.match(inventory.canonical_rowset_sha256,/^[a-f0-9]{64}(?![\s\S])/);
 const epoch=closed(inventory.epoch,['database_oid','backend_pid','transaction_id','relation_oid','relation_filenode','inserted','updated','deleted']);
 assert.equal(epoch.database_oid,current.database_oid);assert.equal(epoch.backend_pid,String(current.backend_pid));assert.equal(epoch.transaction_id,current.transaction_id);
 assert.equal(epoch.relation_oid,inventory.relation_oid);decimal(epoch.relation_filenode,true,4294967295n);
 for(const key of ['inserted','updated','deleted'])decimal(epoch[key],false);
 return {inventory,epoch};
}
function comparePostDatabaseInventory(original,current,prior,fresh){
 const before=postDatabaseInventory(original,prior),after=postDatabaseInventory(current,fresh);
 const {epoch:oldEpoch,...oldInventory}=before.inventory,{epoch:newEpoch,...newInventory}=after.inventory;
 assert.deepEqual(newInventory,oldInventory,'Original canonical Source rowset/count/relation identity changed');
 assert.equal(after.epoch.relation_filenode,before.epoch.relation_filenode,'Original Source relation was rewritten');
 for(const key of ['inserted','updated','deleted'])assert.equal(after.epoch[key],'0','New transaction has already mutated Source inventory');
}

async function readContext(options,recorded,postDatabase=false,authorityPreparation=false){
  let checkPhase='INPUT';
  try{
    const {db,verifiedArchive,freshIntent,finished:priorData}=closed(options,postDatabase?['db','verifiedArchive','freshIntent','finished']:['db','verifiedArchive','freshIntent']);
    const native=()=>assert.ok(db&&typeof db==='object'&&!types.isProxy(db)&&Client.prototype===prototype
      &&Object.getPrototypeOf(db)===prototype&&!Object.hasOwn(db,'query')&&prototype.query===nativeQuery);
    native();
    const prior=postDatabase?priorFinished(priorData):null;
    const captured=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
    const original=readVerifiedPrivateImportSource(verifiedArchive),binding=original.sourceBinding,intent=captured.intent;
    assert.equal(captured.sourceBinding,binding);
    const current=()=>{native();const live=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
      assert.equal(live,captured);assert.equal(readVerifiedPrivateImportSource(verifiedArchive).sourceBinding,binding);};
    const raw=async(sql,args)=>{current();const reply=await Reflect.apply(nativeQuery,db,args===undefined?[sql]:[sql,args]);current();return reply;};
    if(postDatabase)checkPhase='NATIVE_FENCE';
    const firstRead=closed(one(await raw(postDatabase?postDatabaseFenceSql:fenceSql)),postDatabase
      ?['database_oid','backend_pid','transaction_id','read_only','isolation','search_path','first_schema','held_fences','recovery_inventory']:['database_oid','backend_pid','transaction_id']);
    const first=postDatabase?{database_oid:firstRead.database_oid,backend_pid:firstRead.backend_pid,transaction_id:firstRead.transaction_id}:firstRead;
    assert.equal(typeof first.database_oid,'string');assert.match(first.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);
    assert.ok(BigInt(first.database_oid)<=4294967295n);
    assert.ok(Number.isInteger(first.backend_pid)&&first.backend_pid>0&&first.backend_pid<=2147483647);
    assert.equal(typeof first.transaction_id,'string');assert.match(first.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);
    assert.ok(BigInt(first.transaction_id)<=9223372036854775807n);
    if(postDatabase){
      assert.equal(firstRead.search_path,'pg_catalog, pg_temp');assert.equal(firstRead.first_schema,'pg_catalog');
      assert.equal(firstRead.read_only,authorityPreparation?'off':'on');assert.ok(['repeatable read','serializable'].includes(firstRead.isolation));
      assert.equal(firstRead.held_fences,2);assert.equal(first.database_oid,prior.database_oid);assert.equal(first.backend_pid,prior.backend_pid);
      assert.notEqual(first.transaction_id,prior.transaction_id,'A genuinely new transaction is required');
      if(postDatabase)checkPhase='SOURCE_EPOCH';
      const {epoch}=postDatabaseInventory(firstRead.recovery_inventory,first);
      for(const key of ['inserted','updated','deleted'])assert.equal(epoch[key],'0');
    }
    if(postDatabase)checkPhase='ORIGINAL_CONTEXT';
    const row=closed(one(await raw(postDatabase?postDatabaseContextSql:contextSql,postDatabase?[prior.transaction_id]:undefined)),['actor','session_actor','read_only','row_security','replication','search_path',
      'context_count','import_context','control_count','control','manifest_count','manifest','events',...(postDatabase?['isolation','first_schema']:[])]);
    assert.equal(row.actor,'supabase_admin');assert.equal(row.session_actor,row.actor);assert.equal(row.read_only,postDatabase&&!authorityPreparation?'on':'off');
    if(postDatabase)assert.equal(row.isolation,firstRead.isolation);
    assert.equal(row.row_security,'off');assert.equal(row.replication,'origin');assert.equal(row.search_path,postDatabase?'pg_catalog, pg_temp':'pg_catalog');
    if(postDatabase)assert.equal(row.first_schema,'pg_catalog');
    assert.equal(row.context_count,1);assert.equal(row.control_count,1);assert.equal(row.manifest_count,1);
    const ctx=closed(row.import_context,[...witnessKeys,'phase','active_table_oid','active_row_sha256','original_manifest',
      'original_control','shape_matches','unexpired','private_rows',...(postDatabase?['original_inventory','current_inventory']:[])]);
    assert.deepEqual({database_oid:ctx.database_oid,backend_pid:ctx.backend_pid,transaction_id:ctx.transaction_id},postDatabase
      ?{database_oid:prior.database_oid,backend_pid:prior.backend_pid,transaction_id:prior.transaction_id}:first);
    assert.equal(ctx.restore_id,intent.restore_id);assert.equal(ctx.authority_generation,'1');assert.equal(ctx.archive_digest,binding.archive_digest);
    assert.equal(ctx.phase,'FINISHED');assert.equal(ctx.active_table_oid,null);assert.equal(ctx.active_row_sha256,null);
    if(postDatabase)checkPhase='SOURCE_EPOCH';
    assert.equal(ctx.shape_matches,true);assert.equal(ctx.unexpired,true);
    if(postDatabase){
      comparePostDatabaseInventory(ctx.original_inventory,ctx.current_inventory,prior,first);
      assert.deepEqual(ctx.current_inventory,firstRead.recovery_inventory,'Current Source inventory changed during post-DATABASE read');
    }
    if(postDatabase)checkPhase='ORIGINAL_CONTEXT';
    assert.equal(typeof ctx.private_rows,'string');assert.match(ctx.private_rows,/^(?:0|[1-9][0-9]{0,18})(?![\s\S])/);
    assert.ok(BigInt(ctx.private_rows)<=9223372036854775807n);
    assert.equal(ctx.private_rows,original.privateDataMembers.reduce((total,member)=>total+BigInt(member.row_count),0n).toString());
    const expectedManifest={schema:'custodial.immutable-private-import-manifest.v1',archive_digest:binding.archive_digest,
      source_identity_sha256:binding.source_identity_sha256,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
      actor:intent.actor,expires_at:intent.expires_at,target_migration_head:intent.target_migration_head,
      target_release_identity:intent.target_release_identity,catalog:original.selection.databaseTables,private_data_members:original.privateDataMembers};
    assert.deepEqual(ctx.original_manifest,expectedManifest);
    if(postDatabase)checkPhase='CURRENT_CONTROL';
    const controlKeys=['singleton','authority_generation','mutations_paused','state','restore_id','archive_digest','source_project_ref',
      'target_project_ref','release_identity','started_by','started_at','completed_at','failure_reason','updated_at'];
    const originalControl=closed(ctx.original_control,controlKeys),control=closed(row.control,controlKeys);
    for(const name of ['started_at','updated_at']){
      assert.equal(typeof originalControl[name],'string');assert.ok(Number.isFinite(Date.parse(originalControl[name])));
      assert.equal(typeof control[name],'string');assert.ok(Number.isFinite(Date.parse(control[name])));
    }
    assert.deepEqual(originalControl,{singleton:true,authority_generation:1,mutations_paused:true,state:'PREPARING',restore_id:intent.restore_id,
      archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
      release_identity:{archive:binding.source_identity.release,target:intent.target_release_identity,retry_of_restore_id:null},
      started_by:intent.actor,started_at:originalControl.started_at,completed_at:null,failure_reason:null,updated_at:originalControl.updated_at});
    assert.deepEqual(control,{...originalControl,state:recorded?'DATABASE_RESTORED':'PREPARING',
      updated_at:recorded?control.updated_at:originalControl.updated_at});
    if(postDatabase)checkPhase='DATABASE_MARKERS';
    const finished=Object.freeze(Object.fromEntries([...witnessKeys,'private_rows'].map(key=>[key,ctx[key]]).concat([
      ['transaction_authority',false],['admission_resumed',false]])));
    if(postDatabase)assert.deepEqual(finished,prior,'Retained original FINISHED DATA differs');
    const evidence=recorded?buildVerifiedImmutableFreshDatabaseEvidence({verifiedArchive,freshIntent,finished}):null;
    assert.deepEqual(row.manifest,{restore_id:intent.restore_id,authority_generation:'1',archive_digest:binding.archive_digest,
      database_verified:recorded,storage_verified:false,authority_invalidated:false,post_restore_verified:false,
      database_evidence:recorded?evidence.database:{},storage_evidence:{},authority_evidence:{},
      final_manifest_sha256:null,reconciliation_manifest_sha256:null});
    assert.deepEqual(row.events,recorded?[{restore_id:intent.restore_id,authority_generation:'1',phase:'DATABASE',outcome:'PASSED',
      actor:intent.actor,evidence_json:evidence.event}]:[]);
    if(postDatabase)checkPhase='FINAL_FENCE';
    assert.deepEqual(closed(one(await raw(postDatabase?postDatabaseFenceSql:fenceSql)),postDatabase
      ?['database_oid','backend_pid','transaction_id','read_only','isolation','search_path','first_schema','held_fences','recovery_inventory']:['database_oid','backend_pid','transaction_id']),firstRead);
    current();return postDatabase?Object.freeze({...finished,transaction_id:first.transaction_id,original_transaction_id:finished.transaction_id}):finished;
    // Actual read DATA only; never a reusable effect capability or ACK state.
  }catch(error){
    const codeValue=authorityPreparation?'IMMUTABLE_FRESH_AUTHORITY_PREPARATION_UNAVAILABLE':postDatabase?'IMMUTABLE_FRESH_POST_DATABASE_CONTEXT_UNAVAILABLE':'IMMUTABLE_FRESH_COMMIT_CONTEXT_UNAVAILABLE';
    const failure=Object.assign(new Error(codeValue),{
      code:codeValue,outcome:'UNKNOWN',retry_safe:false});
    if(postDatabase)failure.check_phase=checkPhase;
    const code=error&&typeof error==='object'&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code'):null;
    if(code&&Object.hasOwn(code,'value')&&typeof code.value==='string'&&/^[0-9A-Z]{5}$/.test(code.value))failure.sql_state=code.value;
    throw failure;
  }
}

export async function readVerifiedImmutableFreshCommitPreparation(options){return readContext(options,false);}
export async function readVerifiedImmutableFreshCommitRecord(options){return readContext(options,true);}
export async function readVerifiedImmutableFreshPostDatabaseContext(options){return readContext(options,true,true);}
// Fixed SELECT-only DATA preparation in a genuinely new caller-owned RW
// transaction. Private acknowledged-COMMIT/effect admission remains Main-owned.
export async function readVerifiedImmutableFreshAuthorityPreparation(options){return readContext(options,true,true,true);}
