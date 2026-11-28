import {withRehearsalContext} from './fixtures/rehearsal-shell-source.mjs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectPrivateContextCostMode,projectPrivateContextCost,projectPrivateContextCostFailure} from './private-context-cost-observer.mjs';
import {removePrivateContextCostObservation,removeRehearsalRevisions} from './private-context-cost-source-proof.mjs';
import {observePrivateContextCost} from './private-context-cost-diagnostic.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const fixture=()=>({schema:'custodial.private-current-context-cost.v1',scope:'SIGNED_CURRENT_SCHEMA_CONTEXT_ONLY_NOT_DATA_RESTORE',archive_digest:'a'.repeat(64),calls_per_probe:10,
 sizes:{stored_shape_bytes:'123',shape_text_bytes:'4000',stored_manifest_bytes:'100',manifest_text_bytes:'300',stored_epoch_bytes:'500',certificate_current:true,held_locks:'100',employee_rows:'0',group_original_rows:'0',message_original_rows:'0'},
 timings:{owner_fence:'1.000',catalog_epoch:'2.000',inventory_state:'3.000',target_shape:'4.000',catalog_matches:'5.000',assert_context:'6.000',read_context:'0.100',extract_three_data_fields:'1.000'},
 application_data_imported:false,private_data_imported:false,transaction_authority:false,restore_complete:false,admission_resumed:false,rollback_verified:true,readback_connection_closed:true,current428_source_qualified:false});
test('diagnostic mode defaults off and requires the exact existing private route',()=>{
 for(const v of [undefined,'false'])assert.equal(selectPrivateContextCostMode(v,'full_candidate','false'),false);
 assert.equal(selectPrivateContextCostMode('true','backup_only','true'),true);
 for(const a of [['true','full_candidate','true'],['true','backup_only','false'],['TRUE','backup_only','true'],['1','backup_only','true'],[true,'backup_only','true']])assert.throws(()=>selectPrivateContextCostMode(...a));
});
test('only bounded closed measurement metadata with verified rollback and close can leave the process',()=>{
 const v=fixture();assert.deepEqual(projectPrivateContextCost(v),v);
 assert.ok(projectPrivateContextCost({...v,sizes:{...v.sizes,certificate_current:false}}));
 for(const change of [{extra:'PRIVATE'},...['application_data_imported','private_data_imported','transaction_authority','restore_complete','admission_resumed'].map(k=>({[k]:true})),{rollback_verified:false},{readback_connection_closed:false},{calls_per_probe:1},{archive_digest:'PRIVATE'},
  {sizes:{...v.sizes,employee_rows:'1'}},{sizes:{...v.sizes,sql:'PRIVATE'}},{timings:{...v.timings,owner_fence:'NaN'}},{timings:{...v.timings,query:'PRIVATE'}}])assert.equal(projectPrivateContextCost({...v,...change}),null);
 let traps=0;const getter={...v};Object.defineProperty(getter,'sizes',{enumerable:true,get(){traps++;return v.sizes;}});assert.equal(projectPrivateContextCost(getter),null);assert.equal(traps,0);assert.equal(projectPrivateContextCost(new Proxy(v,{})),null);
});
test('the finite observer is append-only and preserves every existing importer byte and authority path',()=>{
 const current=read('./immutable-private-data-import.mjs'),prior=removePrivateContextCostObservation('scripts/immutable-private-data-import.mjs',current);
 assert.equal(sha(prior),'b5c19b9120d232f8b48e3701e55b56837de6da0eca48b6211ac0ce0057ecd582');
 const observedSource=removeRehearsalRevisions('scripts/immutable-private-data-import.mjs',current);
 assert.ok(observedSource.startsWith(prior));const observation=observedSource.slice(prior.length);
 assert.ok(observation.includes('initializeVerifiedImmutableFreshSource({db,verifiedArchive})'));
 assert.ok(observation.includes('prepareVerifiedImmutableFreshRestoreControl({db,verifiedArchive,freshIntent})'));
 assert.ok(observation.includes('begin_immutable_private_import($1::uuid,$2::bigint,$3::text,$4::jsonb)'));
 assert.ok(observation.includes('iteration>=1'));assert.ok(observation.includes('generate_series(1,10)'));
 assert.doesNotMatch(observation,/freshStaged\.set|freshCommitted\.set|stageVerifiedImmutablePrivateData\(|commitVerifiedImmutableFreshData\(|\bCOMMIT\b/);
 assert.ok(observation.includes('application_data_imported:false,private_data_imported:false'));
 assert.throws(()=>removePrivateContextCostObservation('scripts/immutable-private-data-import.mjs',current+'\n'));
});
test('normal runner and workflow are recovered in full and diagnostic cannot enter a native legacy fallback',()=>{
 const runner=read('./run-private-backup-only-rehearsal.mjs'),workflow=withRehearsalContext(read('../.github/workflows/production-backup-migration-rehearsal.yml'));
 assert.equal(sha(removePrivateContextCostObservation('scripts/run-private-backup-only-rehearsal.mjs',runner)),'bca81f466de6733d5968fc23742ce11e765809cb272164dd264e7ff03a37f4b1');
 assert.equal(sha(removePrivateContextCostObservation('.github/workflows/production-backup-migration-rehearsal.yml',workflow)),'e3352172fac50e799262819801d1c4f6396ae45e8664fee92272d445bbf5bcfa');
 assert.throws(()=>removePrivateContextCostObservation('scripts/run-private-backup-only-rehearsal.mjs',runner.replace('lifetimeMs===6*60*60*1000','lifetimeMs===5*60*60*1000')));
 assert.throws(()=>removePrivateContextCostObservation('.github/workflows/production-backup-migration-rehearsal.yml',workflow.replace(' || test -e "$plaintext_dir"','')));
 assert.match(runner,/scope:contextDiagnosticOnly\?'context_cost_only':'backup_only'/);
 assert.match(runner,/disposable_database_restore_outcome:contextDiagnosticOnly\?'NOT_ATTEMPTED'/);
 assert.ok(runner.includes("timeout:300000}"));assert.ok(runner.includes("assert.equal(profile,'private')"));assert.ok(runner.includes("if(contextDiagnosticOnly)assert.deepEqual(ownerProfile,{id:'immutable-private-current-postgres',actor:'postgres'})"));
 assert.ok(runner.indexOf('if(contextDiagnosticOnly)assert.deepEqual(ownerProfile')<runner.indexOf("phase='create_owned_target'"));
});
test('the closed diagnostic caller rolls back before fresh readback and closes before publishing',()=>{
 const s=read('./private-context-cost-diagnostic.mjs');assert.doesNotMatch(s,/\bCOMMIT\b|restore:apply|stageVerifiedImmutableFreshData|production-restore\.mjs/);
 assert.ok(s.indexOf("await query('ROLLBACK')")<s.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
 assert.ok(s.indexOf('Reflect.apply(nativeEnd')<s.indexOf('const result=projectPrivateContextCost'));
 assert.ok(s.includes("context_absent:true,employee_rows:'0',group_original_rows:'0',message_original_rows:'0',controls:'0',releases:'0',registry:'0'"));
});
test('foreign connection names, actor, options and ports refuse before source materialization',async()=>{
 const e={PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY:'true',REHEARSAL_SCOPE:'backup_only',OFFICIAL_LOCAL_STORAGE_PROVIDER:'true',RESTORE_APPLY:'true',RESTORE_DATABASE_ONLY:'true',GITHUB_RUN_ID:'123'};
 const base='postgresql://postgres:fixture@127.0.0.1:5555/mz_schema_rebuild_123';
 for(const url of [base.replace('127.0.0.1','example.com'),base.replace('postgres:','supabase_admin:'),base+'?host=example.com',base+'#fragment',base.replace(':5555/','/'),base.replace('mz_schema_rebuild_123','production')])await assert.rejects(()=>observePrivateContextCost({...e,SUPABASE_DB_URL:url}));
});

test('diagnostic failure retains only exact phase, probe, SQLSTATE and cleanup booleans',()=>{
 const value={schema:'custodial.private-current-context-cost-failure.v1',phase:'MEASURE_CONTEXT',probe:'inventory_state',sql_state:'55000',rollback_command_received:true,readback_verified:false,connection_closed:true};
 assert.deepEqual(projectPrivateContextCostFailure(value),value);
 for(const change of [{query:'PRIVATE SQL'},{phase:'PRIVATE'},{probe:'PRIVATE'},{sql_state:'PRIVATE ROW'},{connection_closed:'yes'}])assert.equal(projectPrivateContextCostFailure({...value,...change}),null);
});

test('diagnostic child failure survives parent transport using only the closed metadata projection',async()=>{
 const source=read('./run-private-backup-only-rehearsal.mjs');const a=source.indexOf('  const run=(command,args,'),z=source.indexOf('  const docker=',a);
 const factory=new Function('ports',`const {root,spawn,projectPrivateContextCostFailure}=ports;const stopping=false,baseEnv={},children=new Set(),phase='private_current_context_cost_only',contextDiagnosticOnly=true;
 let subprocessFailure=null,contextCostFailure=null;${source.slice(a,z)}return {run,receipt:()=>({subprocessFailure,contextCostFailure})};`);
 const detail={schema:'custodial.private-current-context-cost-failure.v1',phase:'MEASURE_CONTEXT',probe:'inventory_state',sql_state:'55000',rollback_command_received:true,readback_verified:false,connection_closed:true};
 for(const payload of [detail,{...detail,query:'PRIVATE SQL'}]){
  const child=`process.stdout.write(${JSON.stringify(JSON.stringify(payload))});process.exitCode=17;`;
  const world=factory({root:tmpdir(),projectPrivateContextCostFailure,spawn:(cmd,args,opts)=>{assert.equal(cmd,process.execPath);assert.deepEqual(args,['scripts/private-context-cost-diagnostic.mjs']);return spawn(process.execPath,['-e',child],opts);}});
  await assert.rejects(()=>world.run(process.execPath,['scripts/private-context-cost-diagnostic.mjs']),/Owned subprocess refused/);
  const r=world.receipt();assert.equal(r.subprocessFailure.operation,'OBSERVE_PRIVATE_CONTEXT_COST');assert.equal(r.subprocessFailure.exit_code,17);
  assert.deepEqual(r.contextCostFailure,Object.hasOwn(payload,'query')?null:detail);assert.doesNotMatch(JSON.stringify(r),/PRIVATE SQL/);
 }
});

test('diagnostic timing uses the original production restore rendering settings and restore session fence',()=>{
 const s=read('./private-context-cost-diagnostic.mjs'),production=read('./production-restore.mjs');
 const settings="set local extra_float_digits = 3;set local datestyle = 'ISO, YMD';set local timezone = 'UTC';set local intervalstyle = 'postgres';set local bytea_output = 'hex'";
 assert.ok(s.includes(settings));assert.ok(production.includes(settings));
 const session="select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))";
 assert.ok(s.includes(session));assert.ok(production.includes(session));
});
