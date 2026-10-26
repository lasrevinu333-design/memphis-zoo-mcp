// DATABASE metadata only, inside the caller's SAME finished DATA transaction.
// No COMMIT, recovery/retry, resume or externally supplied evidence authority.
import assert from 'node:assert/strict';
import {types} from 'node:util';
import pg from 'pg';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {readVerifiedImmutableFreshCommitPreparation,readVerifiedImmutableFreshCommitRecord} from './immutable-private-fresh-restore-commit-context.mjs';
import {buildVerifiedImmutableFreshDatabaseEvidence} from './immutable-private-fresh-restore-evidence.mjs';

const Client=pg.Client,prototype=Client.prototype,nativeQuery=prototype.query,attempted=new WeakSet();
const witnessKeys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest',
 'private_rows','transaction_authority','admission_resumed'];
function closed(value,keys){
 assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype,'Closed original DATABASE metadata required');
 const fields=Object.getOwnPropertyDescriptors(value);assert.deepEqual(Reflect.ownKeys(fields).sort(),keys.slice().sort());
 return Object.fromEntries(keys.map(key=>{const field=fields[key];assert.ok(Object.hasOwn(field,'value')&&field.enumerable,'Original DATABASE accessors refused');return[key,field.value];}));
}
function witness(value){
 assert.ok(Object.isFrozen(value),'Frozen original finished witness required');const row=closed(value,witnessKeys);
 assert.equal(typeof row.database_oid,'string');assert.match(row.database_oid,/^[1-9][0-9]{0,9}(?![\s\S])/);assert.ok(BigInt(row.database_oid)<=4294967295n);
 assert.ok(Number.isSafeInteger(row.backend_pid)&&row.backend_pid>0&&row.backend_pid<=2147483647);
 assert.equal(typeof row.transaction_id,'string');assert.match(row.transaction_id,/^[1-9][0-9]{0,18}(?![\s\S])/);assert.ok(BigInt(row.transaction_id)<=9223372036854775807n);
 assert.equal(typeof row.restore_id,'string');assert.match(row.restore_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/);
 assert.equal(row.authority_generation,'1');assert.equal(typeof row.archive_digest,'string');assert.match(row.archive_digest,/^[a-f0-9]{64}(?![\s\S])/);
 assert.equal(typeof row.private_rows,'string');assert.match(row.private_rows,/^(0|[1-9][0-9]{0,18})(?![\s\S])/);assert.ok(BigInt(row.private_rows)<=9223372036854775807n);
 assert.equal(row.transaction_authority,false);assert.equal(row.admission_resumed,false);return Object.freeze(row);
}
function reply(value){
 assert.ok(value&&typeof value==='object'&&!types.isProxy(value));
 const count=Object.getOwnPropertyDescriptor(value,'rowCount'),rows=Object.getOwnPropertyDescriptor(value,'rows');
 assert.ok(count&&Object.hasOwn(count,'value')&&count.value===1);assert.ok(rows&&Object.hasOwn(rows,'value'));
 const array=rows.value;assert.ok(Array.isArray(array)&&!types.isProxy(array)&&Object.getPrototypeOf(array)===Array.prototype);
 const fields=Object.getOwnPropertyDescriptors(array);assert.deepEqual(Reflect.ownKeys(fields).sort(),['0','length']);
 assert.equal(fields.length.value,1);assert.ok(Object.hasOwn(fields['0'],'value')&&fields['0'].enumerable);
 return closed(fields['0'].value,['control_count','manifest_count','event_count','database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest']);
}
const recordSql=`with changed_control as (
 update custodial_dr.restore_control c set state='DATABASE_RESTORED',updated_at=clock_timestamp()
 from custodial_dr.restore_manifests m,custodial_dr.immutable_private_import_context x
 where c.singleton and c.state='PREPARING' and c.mutations_paused and c.authority_generation=1
  and c.restore_id=$1::uuid and c.authority_generation=$2::bigint and c.archive_digest=$3::text
  and c.source_project_ref=$4::text and c.target_project_ref=$5::text and c.started_by=$6::text
  and c.release_identity=$12::jsonb and c.completed_at is null and c.failure_reason is null
  and m.restore_id=c.restore_id and m.authority_generation=c.authority_generation and m.archive_digest=c.archive_digest
  and not m.database_verified and m.database_evidence='{}'::jsonb
  and not m.storage_verified and not m.authority_invalidated and not m.post_restore_verified
  and m.storage_evidence='{}'::jsonb and m.authority_evidence='{}'::jsonb and m.final_manifest_sha256 is null
  and m.reconciliation_manifest_sha256 is null
  and (select count(*) from custodial_dr.restore_control)=1 and (select count(*) from custodial_dr.restore_manifests)=1
  and not exists(select 1 from custodial_dr.restore_events)
  and current_user=session_user and current_user='supabase_admin'
  and x.database_oid=$9::oid and x.database_oid=(select oid from pg_catalog.pg_database where datname=current_database())
  and x.backend_pid=$10::integer and x.backend_pid=pg_backend_pid() and x.transaction_id=$11::bigint and x.transaction_id=txid_current()
  and x.restore_id=c.restore_id and x.authority_generation=c.authority_generation and x.archive_digest=c.archive_digest
  and x.phase='FINISHED' and x.active_table_oid is null and x.active_row_sha256 is null
  and x.original_control=to_jsonb(c)
 returning c.restore_id,c.authority_generation,c.archive_digest
), changed_manifest as (
 update custodial_dr.restore_manifests m set database_verified=true,database_evidence=$7::jsonb,updated_at=clock_timestamp()
 from changed_control c where m.restore_id=c.restore_id and m.authority_generation=c.authority_generation and m.archive_digest=c.archive_digest
  and not m.database_verified and m.database_evidence='{}'::jsonb
 returning m.restore_id,m.authority_generation,m.archive_digest
), inserted_event as (
 insert into custodial_dr.restore_events(restore_id,authority_generation,phase,outcome,actor,evidence_json)
 select m.restore_id,m.authority_generation,'DATABASE','PASSED',$6::text,$8::jsonb from changed_manifest m
 join changed_control c on c.restore_id=m.restore_id and c.authority_generation=m.authority_generation and c.archive_digest=m.archive_digest
 returning restore_id,authority_generation
)
select (select count(*)::int from changed_control) control_count,(select count(*)::int from changed_manifest) manifest_count,
 (select count(*)::int from inserted_event) event_count,
 (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
 pg_backend_pid() backend_pid,txid_current()::text transaction_id,
 (select restore_id::text from inserted_event) restore_id,(select authority_generation::text from inserted_event) authority_generation,
 (select archive_digest from changed_manifest) archive_digest`;

export async function recordVerifiedImmutableFreshDatabaseEvidence(options){
 const {db,verifiedArchive,freshIntent}=closed(options,['db','verifiedArchive','freshIntent']);
 const native=()=>assert.ok(db&&typeof db==='object'&&!types.isProxy(db)&&Client.prototype===prototype
  &&Object.getPrototypeOf(db)===prototype&&!Object.hasOwn(db,'query')&&prototype.query===nativeQuery,'Actual original native pg.Client required');
 native();assert.ok(!attempted.has(db),'Original DATABASE record attempt already consumed');attempted.add(db);
 const opts=Object.freeze({db,verifiedArchive,freshIntent}),original=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
 const {intent,sourceBinding}=closed(original,['intent','envelope','sourceBinding']);
 const current=()=>{
  native();const live=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
  assert.ok(live.intent===original.intent&&live.envelope===original.envelope&&live.sourceBinding===sourceBinding,'Original DATABASE intent/source changed');
 };
 const guarded=async(operation)=>{
  current();let value,failed=false,failure;
  try{value=await operation();}catch(error){failed=true;failure=error;}
  try{current();}catch(error){if(failed)throw new AggregateError([failure,error],'Original DATABASE operation/currentness refused',{cause:failure});throw error;}
  if(failed)throw failure;return value;
 };
 const finished=witness(await guarded(()=>readVerifiedImmutableFreshCommitPreparation(opts)));
 assert.equal(finished.restore_id,intent.restore_id);assert.equal(finished.authority_generation,String(intent.authority_generation));
 assert.equal(finished.archive_digest,intent.archive_digest);assert.equal(finished.archive_digest,sourceBinding.archive_digest);
 const evidence=buildVerifiedImmutableFreshDatabaseEvidence({verifiedArchive,freshIntent,finished});
 assert.ok(Object.isFrozen(evidence));const payload=closed(evidence,['database','event']);
 assert.ok(payload.database&&typeof payload.database==='object'&&Object.isFrozen(payload.database));
 assert.ok(payload.event&&typeof payload.event==='object'&&Object.isFrozen(payload.event));
 const databaseJson=JSON.stringify(payload.database),eventJson=JSON.stringify(payload.event);
 current();
 const again=witness(await guarded(()=>readVerifiedImmutableFreshCommitPreparation(opts)));
 assert.deepEqual(again,finished,'Original FINISHED witness changed before DATABASE write');
 const releaseIdentity={archive:sourceBinding.source_identity.release,target:intent.target_release_identity,retry_of_restore_id:null};
 const recorded=reply(await guarded(()=>Reflect.apply(nativeQuery,db,[recordSql,[finished.restore_id,finished.authority_generation,finished.archive_digest,
  sourceBinding.project_ref,intent.target_project_ref,intent.actor,databaseJson,eventJson,
  finished.database_oid,finished.backend_pid,finished.transaction_id,JSON.stringify(releaseIdentity)]])));
 assert.deepEqual(recorded,{control_count:1,manifest_count:1,event_count:1,database_oid:finished.database_oid,
  backend_pid:finished.backend_pid,transaction_id:finished.transaction_id,restore_id:finished.restore_id,
  authority_generation:finished.authority_generation,archive_digest:finished.archive_digest},'Incomplete original DATABASE metadata record');
 const confirmed=witness(await guarded(()=>readVerifiedImmutableFreshCommitRecord(opts)));
 assert.deepEqual(confirmed,finished,'Original FINISHED witness changed after DATABASE write');current();
 return Object.freeze({database:payload.database,event:payload.event}); // DATA, never COMMIT/restore/resume authority.
}
