import assert from 'node:assert/strict';
import pg from 'pg';
import {readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {reinstateUnvalidatedRestoreChecks,suspendUnvalidatedRestoreChecks} from './restore-unvalidated-checks.mjs';

const nativeQuery=pg.Client.prototype.query;
const states=new WeakMap();
const table={schema_name:'public',table_name:'completion_responses'};
const checkName='completion_responses_client_completion_id_uuid';
const checkDefinition="CHECK (client_completion_id IS NULL OR client_completion_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text) NOT VALID";
const readShape='select custodial_dr.immutable_import_target_shape() as shape';

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

export async function stageLegacyCompletionCheck(db,archive,freshIntent){
  const captured=readVerifiedImmutableFreshRestoreIntent(freshIntent,archive);
  const profile=readVerifiedImmutableArchiveOwnerProfile(archive);
  if(profile.id!=='immutable-private-current-postgres'||profile.actor!=='postgres'
    ||!['127.0.0.1','localhost'].includes(db.connectionParameters.host)
    ||!/^mz_schema_rebuild_[1-9][0-9]*$/.test(db.connectionParameters.database))return;
  assert.ok(!states.has(freshIntent));
  const original=readVerifiedPrivateImportSource(archive);
  assert.equal(original.sourceBinding,captured.sourceBinding);
  assert.equal(original.selection.databaseTables.filter(row=>row.schema_name===table.schema_name
    &&row.table_name===table.table_name).length,1);
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
  await query('select custodial_dr.immutable_import_lock_catalogs()');
  await query('lock table custodial_dr.application_mutation_leases in share mode');
  await query(`lock table public.release_deployment_manifest,public.custodial_release_authority_restore_inventory,
    supabase_migrations.schema_migrations in share mode`);
  await query('lock table only public.completion_responses in access exclusive mode');
  const {rows:[{shape:originalShape}]}=await query(readShape);
  const importShape=structuredClone(originalShape);
  const relation=importShape.relations.find(item=>item.schema==='public'&&item.name==='completion_responses');
  assert.equal(relation.kind,'r');
  assert.equal(relation.partition,false);
  const checks=relation.constraints.filter(row=>row.type==='c'&&!row.valid);
  if(!checks.length)return;
  assert.deepEqual(checks,[{name:checkName,valid:false,type:'c',definition:checkDefinition}]);
  assert.equal((await query('select count(*)::int as rows from only public.completion_responses')).rows[0].rows,0);
  relation.constraints=relation.constraints.filter(row=>row.name!==checkName);
  if(!relation.constraints.length)relation.constraints=null;
  const checksToReinstate=await suspendUnvalidatedRestoreChecks({query},[table]);
  assert.equal(checksToReinstate.length,1);
  assert.equal(checksToReinstate[0].constraint_name,checkName);
  assert.equal(checksToReinstate[0].definition,checkDefinition);
  assert.deepEqual((await query(readShape)).rows,[{shape:importShape}]);
  states.set(freshIntent,{db,archive,captured,originalShape,importShape,checksToReinstate});
}

export async function reinstateLegacyCompletionCheck(db,archive,freshIntent,finished){
  const state=states.get(freshIntent);
  if(!state)return;
  assert.equal(db,state.db);
  assert.equal(archive,state.archive);
  assert.ok(!state.evidence);
  const query=targetQuery(db,archive,freshIntent,state.captured);
  const reinstated=await reinstateUnvalidatedRestoreChecks({query},state.checksToReinstate);
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
