import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {recordImmutableFreshProgress} from './immutable-private-stage-diagnostic.mjs';
import {reinstateUnvalidatedRestoreChecks,suspendUnvalidatedRestoreChecks} from './restore-unvalidated-checks.mjs';

const nativeQuery=pg.Client.prototype.query;
const states=new WeakMap();
const table={schema_name:'public',table_name:'completion_responses'};
const checkName='completion_responses_client_completion_id_uuid';
const checkDefinition="CHECK (client_completion_id IS NULL OR client_completion_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text) NOT VALID";
const readShape='select custodial_dr.immutable_import_target_shape() as shape';
const sha=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const exactGuardHash='3461ee511455447a44f1d676102a74c8544978127cfc9645dc27e46d48f50296';
const checkIdentity='"public"."completion_responses"';
const readGuard=`select to_jsonb(e) event, to_jsonb(p)-'prosrc' attributes, pg_get_functiondef(p.oid) definition
  from pg_catalog.pg_event_trigger e join pg_catalog.pg_proc p on p.oid=e.evtfoid
  where e.evtname='custodial_dr_guard_application_ddl' and e.evtevent='ddl_command_start'
    and e.evtenabled='O' and e.evttags is null and pg_get_userbyid(e.evtowner)='postgres'
    and p.oid=to_regprocedure('custodial_dr.guard_application_ddl()') and p.prosecdef
    and pg_get_userbyid(p.proowner)='postgres'`;
const readCheck=`select pg_get_constraintdef(oid,true) definition, obj_description(oid,'pg_constraint') comment
  from pg_catalog.pg_constraint where conrelid='public.completion_responses'::regclass
    and conname='${checkName}' and contype='c' and not convalidated and conislocal and coninhcount=0`;

// This branch belongs to the private native transaction that prepared the
// isolated restore. All other commands still take the original DDL fence.
function isolatedGuard(guard,check,dbName,witness,intent){
  const drop=sha(`alter table ${checkIdentity} drop constraint "${checkName}"`);
  const add=sha(`alter table ${checkIdentity} add constraint "${checkName}" ${checkDefinition}`);
  const comment=check.comment===null?null:sha(`comment on constraint "${checkName}" on ${checkIdentity} is ${literal(check.comment)}`);
  assert.match(dbName,/^mz_schema_rebuild_[1-9][0-9]*$/);
  assert.match(witness.database_oid,/^[1-9][0-9]*$/);
  assert.match(witness.transaction_id,/^[1-9][0-9]*$/);
  assert.ok(Number.isSafeInteger(witness.backend_pid)&&witness.backend_pid>0);
  const original='  perform custodial_dr.acquire_application_mutation_fence();';
  assert.equal(guard.definition.split(original).length,2);
  const scope=`  IF current_database()=${literal(dbName)} AND session_user='postgres' AND current_user=session_user
    AND pg_backend_pid()=${witness.backend_pid} AND txid_current()=${witness.transaction_id}
    AND current_setting('session_replication_role')='origin'
    AND current_setting('cron.launch_active_jobs',true)='off'
    AND clock_timestamp()<${literal(intent.expires_at)}::timestamptz
    AND EXISTS(SELECT 1 FROM custodial_dr.restore_control WHERE singleton AND mutations_paused AND state='PREPARING'
      AND authority_generation=1 AND restore_id=${literal(intent.restore_id)}::uuid AND archive_digest=${literal(intent.archive_digest)})
    AND (SELECT count(*) FROM unnest(ARRAY['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
      WHERE EXISTS(SELECT 1 FROM pg_locks l WHERE locktype='advisory' AND pid=pg_backend_pid()
        AND l.database=${witness.database_oid}::oid AND granted AND mode='ExclusiveLock' AND objsubid=1
        AND classid=((hashtextextended(f.name,0)>>32)&4294967295)::oid
        AND objid=(hashtextextended(f.name,0)&4294967295)::oid))=2
  THEN
    IF (TG_TAG='ALTER TABLE' AND encode(extensions.digest(convert_to(current_query(),'UTF8'),'sha256'),'hex')='${drop}'
      AND NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context))
    OR (EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
        WHERE database_oid=${witness.database_oid}::oid AND backend_pid=pg_backend_pid() AND transaction_id=txid_current()
          AND restore_id=${literal(intent.restore_id)}::uuid AND archive_digest=${literal(intent.archive_digest)}
          AND authority_generation=1 AND phase='FINISHED' AND active_table_oid IS NULL AND active_row_sha256 IS NULL)
      AND ((TG_TAG='ALTER TABLE' AND encode(extensions.digest(convert_to(current_query(),'UTF8'),'sha256'),'hex')='${add}')
        ${comment?`OR (TG_TAG='COMMENT' AND encode(extensions.digest(convert_to(current_query(),'UTF8'),'sha256'),'hex')='${comment}')`:''}
        OR (TG_TAG='CREATE FUNCTION' AND encode(extensions.digest(convert_to(current_query(),'UTF8'),'sha256'),'hex')='${exactGuardHash}')))
    THEN RETURN; END IF;
  END IF;
`;
  return guard.definition.replace(original,()=>scope+original);
}

// The signed source and private fresh intent are required on both sides of
// every native query, including queries issued by the shared CHECK helper.
function targetQuery(db,archive,intent,captured){
  return async (sql,args=[])=>{
    const current=()=>{
      assert.equal(readVerifiedImmutableFreshRestoreIntent(intent,archive),captured);
      assert.equal(Object.getPrototypeOf(db),pg.Client.prototype);
      assert.equal(db.query,nativeQuery);
      assert.equal(db._txStatus,'T');
    };
    current();
    const reply=await Reflect.apply(nativeQuery,db,[sql,args]);
    current();
    return reply;
  };
}

export async function prepareLegacyCompletionGuard(db,archive,freshIntent,initialized){
  const captured=readVerifiedImmutableFreshRestoreIntent(freshIntent,archive);
  const profile=readVerifiedImmutableArchiveOwnerProfile(archive);
  if(profile.id!=='immutable-private-current-postgres'||profile.actor!=='postgres'
    ||process.env.REHEARSAL_SCOPE!=='backup_only'
    ||process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER!=='true')return;
  assert.equal(process.env.GITHUB_ACTIONS,'true','Owned current restore worker requires its GitHub Actions marker');
  assert.match(process.env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
  const dbName=db.connectionParameters.database;
  assert.equal(db.connectionParameters.host,'127.0.0.1');
  assert.equal(dbName,'mz_schema_rebuild_'+process.env.GITHUB_RUN_ID);
  assert.ok(!states.has(freshIntent));
  const original=readVerifiedPrivateImportSource(archive);
  assert.equal(original.sourceBinding,captured.sourceBinding);
  assert.equal(original.selection.databaseTables.filter(row=>row.schema_name===table.schema_name
    &&row.table_name===table.table_name).length,1);
  const query=targetQuery(db,archive,freshIntent,captured);
  const ready=await query(`select current_database() db, current_user actor,session_user login,
    (select oid::text from pg_database where datname=current_database()) database_oid,
    pg_backend_pid() backend_pid,txid_current()::text transaction_id,
    current_setting('cron.launch_active_jobs',true) cron,
    (select count(*)::int from custodial_dr.restore_control where singleton and state='READY' and not mutations_paused
      and authority_generation=0 and restore_id is null and archive_digest is null) controls`);
  assert.deepEqual(ready.rows,[{db:dbName,actor:'postgres',login:'postgres',database_oid:initialized.database_oid,
    backend_pid:initialized.backend_pid,transaction_id:initialized.transaction_id,cron:'off',controls:1}]);
  await query('select custodial_dr.immutable_import_lock_catalogs()');
  await query('lock table only public.completion_responses in access exclusive mode');
  const checks=await query(readCheck);
  if(!checks.rowCount)return;
  assert.equal(checks.rowCount,1);
  const check=checks.rows[0];
  assert.equal(check.definition,checkDefinition);
  assert.equal((await query('select count(*)::int as rows from only public.completion_responses')).rows[0].rows,0);
  const guards=await query(readGuard);
  assert.equal(guards.rowCount,1);
  const guard=guards.rows[0];
  assert.equal(sha(guard.definition),exactGuardHash);
  const scopedDefinition=isolatedGuard(guard,check,dbName,initialized,captured.intent);
  await query(scopedDefinition);
  assert.deepEqual((await query(readGuard)).rows,[{...guard,definition:scopedDefinition}]);
  states.set(freshIntent,{db,archive,captured,guard,scopedDefinition,check});
}

export async function stageLegacyCompletionCheck(db,archive,freshIntent){
  const state=states.get(freshIntent);
  if(!state)return;
  assert.equal(db,state.db);
  assert.equal(archive,state.archive);
  const captured=state.captured;
  const query=targetQuery(db,archive,freshIntent,captured);
  const identity=await query(`select current_database() db,current_user actor,session_user login,
    current_setting('cron.launch_active_jobs',true) cron,
    current_setting('session_replication_role') replication,
    (select count(*)::int from custodial_dr.immutable_private_import_context) imports,
    (select count(*)::int from custodial_dr.restore_control
     where singleton and state='PREPARING' and mutations_paused and restore_id=$1::uuid
      and authority_generation=$2::bigint and archive_digest=$3::text) controls`,
    [captured.intent.restore_id,captured.intent.authority_generation,captured.intent.archive_digest]);
  assert.deepEqual(identity.rows,[{db:db.connectionParameters.database,actor:'postgres',login:'postgres',
    cron:'off',replication:'origin',imports:0,controls:1}]);
  await query('lock table custodial_dr.application_mutation_leases in share mode');
  await query(`lock table public.release_deployment_manifest,public.custodial_release_authority_restore_inventory,
    supabase_migrations.schema_migrations in share mode`);
  const {rows:[{shape:originalShape}]}=await query(readShape);
  const importShape=structuredClone(originalShape);
  const relation=importShape.relations.find(item=>item.schema==='public'&&item.name==='completion_responses');
  assert.equal(relation.kind,'r');
  assert.equal(relation.partition,false);
  assert.deepEqual(relation.constraints.filter(row=>row.type==='c'&&!row.valid),
    [{name:checkName,valid:false,type:'c',definition:checkDefinition}]);
  assert.equal((await query('select count(*)::int as rows from only public.completion_responses')).rows[0].rows,0);
  relation.constraints=relation.constraints.filter(row=>row.name!==checkName);
  if(!relation.constraints.length)relation.constraints=null;
  const checksToReinstate=await suspendUnvalidatedRestoreChecks({query},[table]);
  assert.equal(checksToReinstate.length,1);
  assert.equal(checksToReinstate[0].constraint_name,checkName);
  assert.equal(checksToReinstate[0].definition,checkDefinition);
  assert.equal(checksToReinstate[0].constraint_comment,state.check.comment);
  assert.deepEqual((await query(readShape)).rows,[{shape:importShape}]);
  states.set(freshIntent,{...state,originalShape,importShape,checksToReinstate});
  recordImmutableFreshProgress({fresh_stage:'LEGACY_COMPLETION_UUID_CHECK_STAGED'});
}

export async function reinstateLegacyCompletionCheck(db,archive,freshIntent,finished){
  const state=states.get(freshIntent);
  if(!state)return;
  assert.equal(db,state.db);
  assert.equal(archive,state.archive);
  assert.ok(!state.evidence);
  const query=targetQuery(db,archive,freshIntent,state.captured);
  const reinstated=await reinstateUnvalidatedRestoreChecks({query},state.checksToReinstate);
  assert.deepEqual((await query(readGuard)).rows,[{...state.guard,definition:state.scopedDefinition}]);
  await query(state.guard.definition);
  assert.deepEqual((await query(readGuard)).rows,[state.guard]);
  // The import seal is immutable. Prove the full catalog on both sides of
  // the only permitted difference, then retain those exact native shapes
  // for the existing commit and post-commit readbacks.
  const originalShape=JSON.stringify(state.originalShape);
  const importShape=JSON.stringify(state.importShape);
  const verified=await query(`select c.target_shape=$2::jsonb
      and custodial_dr.immutable_import_target_shape()=$1::jsonb as matches
    from custodial_dr.immutable_private_import_context c
    where c.database_oid=(select oid from pg_catalog.pg_database where datname=current_database())
      and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
      and c.restore_id=$3::uuid and c.authority_generation=$4::bigint and c.archive_digest=$5::text
      and c.phase='FINISHED' and c.active_table_oid is null and c.active_row_sha256 is null`,
    [originalShape,importShape,finished.restore_id,
      finished.authority_generation,finished.archive_digest]);
  assert.deepEqual(verified.rows,[{matches:true}],'Restored completion UUID check did not recover the original catalog');
  const constraints=Object.freeze(reinstated.constraints.map(row=>Object.freeze(row)));
  states.set(freshIntent,{archive,captured:state.captured,
    catalog:Object.freeze({originalShape,importShape}),
    evidence:Object.freeze({...reinstated,constraints,mode:'REINSTATED_BEFORE_COMMIT'})});
  recordImmutableFreshProgress({fresh_stage:'LEGACY_COMPLETION_UUID_CHECK_RESTORED'});
}

export function readLegacyCompletionCheckEvidence(archive,freshIntent){
  const state=states.get(freshIntent);
  if(!state)return undefined;
  assert.equal(archive,state.archive);
  assert.equal(readVerifiedImmutableFreshRestoreIntent(freshIntent,archive),state.captured);
  assert.ok(state.evidence,'Completion UUID check must be reinstated before recording restore evidence');
  return state.evidence;
}

export function readLegacyCompletionCheckCatalog(archive,freshIntent){
  return readLegacyCompletionCheckEvidence(archive,freshIntent) ? states.get(freshIntent).catalog : undefined;
}
