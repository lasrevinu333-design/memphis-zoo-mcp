import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {prepareOriginalMigrationReceipt} from './original-release-migration-commit.mjs';
import assert from 'node:assert/strict';
import {assertCurrent429ForwardMetadata,current429,readCurrent429Plan,readVerifiedCurrent429ForwardQualificationSource} from './current429-forward-qualification-source.mjs';
import {assertCurrent429CatalogDelta} from './current429-forward-readback.mjs';
import {verifyCurrent429Result} from './verify-current429-rehearsal.mjs';
import {parseRehearsalScratchCapacity} from './run-private-backup-only-rehearsal.mjs';
import {privateScratchVolumeName,assertPrivateScratchMount} from './run-official-local-storage-rehearsal.mjs';
import {restoreCurrent429ProofBudgets,summarizeCurrentWeekCoverage} from './current428-rollback-target.mjs';
import {commitPreparedCurrent429,beginCurrent429ApplyTransaction,releaseCurrent429ApplicationLocks,verifySignedCurrent429Receipt} from './apply-current429-forward-plan.mjs';
import {stableJson,signBinding,releaseMigrationRehearsalAttestationBinding} from './disaster-recovery-crypto.mjs';
import {compileCurrent429RecurringReceiptSource,readVerifiedCurrent429RecurringReceiptSource,recurringReceiptIdentity} from './immutable-current429-recurring-receipt-source.mjs';
import {loadImmutableCurrentPostgresSource} from './immutable-private-postgres-source.mjs';

test('exact source plan binds four migrations to baseline 429',()=>{
  const plan=readCurrent429Plan();
  assert.equal(plan.plan_sha256,'e4c75bc238aaf08c64ac6205bfd2c7910d99e59608b532a1e98e698e0e76ecde');
  assert.equal(plan.expected_target_ledger_count,433);
  assert.equal(plan.pending.length,4);
  assert.ok(plan.pending.every(item=>item.version>current429.sourceHead&&!/^\s*begin;/i.test(item.body)));
  assert.throws(()=>readVerifiedCurrent429ForwardQualificationSource({...current429}));
});

test('backup 45645963579 admission checks the signed v2 migration head field',()=>{
  const declaration=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension-v2.active.json',import.meta.url),'utf8'));
  const metadata={
    sourceBinding:{archive_digest:current429.archiveDigest,project_ref:declaration.project_ref,source_identity:{
      backup_tool_commit:current429.producerCommit,backup_tool_tree:current429.producerTree,
      migration_ledger_sha256:current429.sourceLedgerSha256,
    }},
    binding:{captured_migration_head:declaration.observed_ledger_head,captured_ledger_count:declaration.observed_ledger_count,
      ledger_sha256:declaration.ledger_sha256,catalog_fingerprint:declaration.observed_catalog_fingerprint},
  };
  assert.doesNotThrow(()=>assertCurrent429ForwardMetadata(metadata));
  assert.throws(()=>assertCurrent429ForwardMetadata({...metadata,binding:{...metadata.binding,
    captured_migration_head:'20261115162648',captured_ledger_head:current429.sourceHead}}));
});

test('the 429 restore supports exactly the signed recurring receipt callback without changing its normal body',()=>{
  const original=loadImmutableCurrentPostgresSource();
  const extended=compileCurrent429RecurringReceiptSource();
  extended.assertCurrent();
  assert.throws(()=>readVerifiedCurrent429RecurringReceiptSource({archive_digest:current429.archiveDigest}));
  assert.deepEqual(extended.recipes.slice(0,-1),original.recipes);
  assert.deepEqual(extended.statements.slice(1,-1),original.statements.slice(1,-1));
  const recipe=extended.recipes.at(-1);
  assert.equal(recipe.identity,recurringReceiptIdentity);
  assert.equal(recipe.beforeHash,'d2e502ffaa6767d8bd0f51e64e1998f2fecfa078a4c55538ec6b2fdb2f4708e2');
  assert.equal(recipe.after.replace(/ -- Historical receipt DATA[^]*? THEN RETURN NEW; END IF;\n/,''),recipe.before);
  assert.match(recipe.after,/current_user=session_user AND current_user='postgres'/);
  assert.match(recipe.after,/immutable_import_matches_deferred_original_record\(TG_RELID,NEW\) IS TRUE/);
  const rows=(statement,tag)=>JSON.parse(statement.sql.split(tag)[1]);
  const guards='$current_original_guard_cohort$',profiles='$current_original_guard_profiles$';
  const admission=rows(extended.statements[0],guards);
  const installation=rows(extended.statements.at(-1),profiles);
  assert.deepEqual(admission.slice(0,-1),rows(original.statements[0],guards));
  assert.deepEqual(installation.slice(0,-1),rows(original.statements.at(-1),profiles));
  const {identity,definition_sha256,registry_identity,security_definer,...trigger}=admission.at(-1);
  assert.deepEqual([identity,definition_sha256,registry_identity,security_definer],[recipe.identity,recipe.afterHash,null,true]);
  assert.deepEqual([trigger.schema,trigger.table,trigger.name,trigger.type,trigger.enabled,trigger.constraint,trigger.deferrable,trigger.initially_deferred],
    ['custodial_coverall','recurring_materialization_receipts','manual_recurring_delivery_after_receipt',5,'O',true,true,true]);
  assert.deepEqual(installation.at(-1).triggers,[trigger]);
  assert.match(extended.statements.at(-1).sql,/p_table_oid NOT IN\([^\n]+,'custodial_coverall\.recurring_materialization_receipts'::regclass\)/);
});

test('only the four exact routine additions and their intended grants may survive in the target',()=>{
  const names=['custodial_feedback_create_current_employee','custodial_assign_employee_device_at_epoch',
    'static_weekly_initial_fill_slots','msg_set_memphis_thread_context_for_turn'];
  const source={functions:[{schema_name:'public',function_name:'existing'}],routine_grants:[],tables:[]};
  const target={...source,functions:[...source.functions,...names.map(function_name=>({
    schema_name:'public',function_name,owner_name:'migration_owner',definition:'SECURITY DEFINER',identity_arguments:'fixture',
  }))],routine_grants:names.map(function_name=>({
    schema_name:'public',function_name,grantor:'migration_owner',identity_arguments:'fixture',
    privilege_type:'EXECUTE',is_grantable:false,grantee:function_name===names[2]?'static_weekly_control_plane':'service_role',
  }))};
  assert.doesNotThrow(()=>assertCurrent429CatalogDelta(source,target));
  for (const mutate of [
    target=>target.tables.push({changed:true}),
    target=>target.functions.shift(),
    target=>target.routine_grants[0].grantee='PUBLIC',
    target=>target.routine_grants[1].is_grantable=true,
  ]){
    const changed=structuredClone(target);
    mutate(changed);
    assert.throws(()=>assertCurrent429CatalogDelta(source,changed));
  }
});

test('scratch capacity is bounded to owned PostgreSQL paths and exact local mount',()=>{
  const data='Filesystem 1024-blocks Used Available Capacity Mounted on\n';
  const row='/dev/fake 20000000 4000000 16000000 20% /fixture\n';
  const paths=data+row.repeat(3);
  const result=parseRehearsalScratchCapacity(paths,paths,'ext2/ext3\next2/ext3\noverlayfs');
  assert.deepEqual(Object.keys(result),['pgdata','wal','process_tmp']);
  assert.equal(result.pgdata.free_bytes,16_000_000*1024);
  assert.equal(result.pgdata.free_inodes,16_000_000);
  assert.throws(()=>parseRehearsalScratchCapacity(data+row,paths,'ext2/ext3\next2/ext3\noverlayfs'));
  const owner='a'.repeat(32),name='mz_schema_rebuild_1234',destination='/var/lib/postgresql/data';
  const volume=privateScratchVolumeName(name,owner);
  const inspect={Config:{Labels:{'custodial.private-backup-rehearsal':owner}},HostConfig:{Tmpfs:{}},
    Mounts:[{Type:'volume',Name:volume,Driver:'local',Destination:destination,RW:true}]};
  assert.equal(assertPrivateScratchMount(inspect,name,owner),true);
  inspect.Mounts[0].Name+='wrong';
  assert.throws(()=>assertPrivateScratchMount(inspect,name,owner));
});

test('apply obtains all session locks before transaction snapshot',async()=>{
  const commands=[];
  const tables=await beginCurrent429ApplyTransaction(async(sql,args)=>commands.push([sql,args]),async()=>{
    commands.push(['enumerate outside transaction']);
    return ['public.fixture'];
  });
  assert.deepEqual(tables,['public.fixture']);
  assert.equal(commands.at(-2)[0],'enumerate outside transaction');
  assert.deepEqual(commands.slice(2,5).map(([sql,args])=>[sql,args[0]]),[
    ['select pg_advisory_lock(hashtextextended($1,0))','memphis-zoo-release-migration-plan'],
    ['select pg_advisory_lock(hashtextextended($1,0))','memphis-zoo-application-mutation-admission'],
    ['select pg_advisory_lock(hashtextextended($1,0))','memphis-zoo-application-mutation-fence'],
  ]);
  assert.equal(commands.at(-1)[0],'begin isolation level serializable');
});

function fixtureWeek() {
  return Array.from({length:7},(_,index)=>({today:'2026-11-25',service_date:'2026-11-'+(23+index),
    governed:true,projection_status:'current',roster_employees:2,current_employees:2,normal_assignments:3,
    assignment_differences:0,employees_missing_assignments:0,lunch_coverage_current:true,employee_days_sha256:'e'.repeat(64),reader_execute:true,
    coverage_version:2,capacity_rows:0,invalid_capacity_rows:0,explicit_off_day:false}));
}

test('explicit proof timeouts are restored and only the two application locks are released after commit',async()=>{
  const commands=[];
  await restoreCurrent429ProofBudgets(async(sql)=>commands.push(sql));
  await releaseCurrent429ApplicationLocks(async(sql,args)=>{
    commands.push([sql,args[0]]);
    return {rows:[{unlocked:true}]};
  });
  assert.deepEqual(commands,[
    "set local lock_timeout='5s'","set local statement_timeout='180s'",
    ['select pg_advisory_unlock(hashtextextended($1,0)) unlocked','memphis-zoo-application-mutation-fence'],
    ['select pg_advisory_unlock(hashtextextended($1,0)) unlocked','memphis-zoo-application-mutation-admission'],
  ]);
  await assert.rejects(releaseCurrent429ApplicationLocks(async()=>({rows:[{unlocked:false}]})),/Exact production mutation lock release required/);
});

test('current employee coverage accepts verified CoverAll and explicit off days, and rejects uncertain evidence',()=>{
  const week=fixtureWeek();
  week[2].capacity_rows=1;
  Object.assign(week[3],{normal_assignments:0,explicit_off_day:true});
  const summarize=()=>summarizeCurrentWeekCoverage(week,{requireVersion2:true});
  assert.equal(summarize().working_coverage,true);
  assert.deepEqual(summarize().explicit_off_days,['2026-11-26']);
  week[2].invalid_capacity_rows=1;
  assert.deepEqual(summarize().dates_missing_coverage,['2026-11-25']);
  week[2].invalid_capacity_rows=0;
  week[3].explicit_off_day=false;
  assert.deepEqual(summarize().dates_missing_coverage,['2026-11-26']);
  Object.assign(week[3],{explicit_off_day:true,roster_employees:0,current_employees:0});
  assert.throws(summarize);
});

test('signing requires the successful scoped result, checked catalog and verified rollback',()=>{
  const plan=readCurrent429Plan(),candidate='a'.repeat(40),tree='b'.repeat(40),runId='246';
  const week=fixtureWeek();
  const capacity={filesystem_type:'ext2/ext3',free_bytes:14*1024**3,free_inodes:80*1024};
  const phase={pgdata:capacity,wal:capacity};
  const scratch={layout:'owned_local_volume',volume_removed:true,samples:2,minimum_bytes:12*1024**3,
    minimum_inodes:64*1024,admission:phase,final:phase,minimum:phase};
  const result={scratch,source_commit:candidate,source_tree:tree,qualification_run_id:runId,backup_run_id:current429.runId,
    archive_digest:current429.archiveDigest,ok:true,disposable_database_restore_outcome:'RESULT_RETURNED',
    provider_verified:true,isolated_reconciliation_observed:true,cleanup_checked:true,production_restore_performed:false,
    completed_at:'2026-11-25T20:30:00Z',current429_target_capture:{
      scope:'isolated_current429_rollback_target',archive_digest:current429.archiveDigest,candidate_commit:candidate,
      candidate_tree:tree,plan_sha256:plan.plan_sha256,rollback_verified:true,production_written:false,
      target:{checked_routine_and_grant_delta:true,recovery_inventory_exact:true,event_guards_preserved:true,event_guard_sha256:'f'.repeat(64),
        ledger_count:433,ledger_head:plan.expected_target_ledger_head,ledger_sha256:'c'.repeat(64),
        catalog:{fingerprint:'d'.repeat(64)},current_chicago_week:week,current_chicago_week_coverage:summarizeCurrentWeekCoverage(week)},
    }};
  const verify=result=>verifyCurrent429Result({receipt:JSON.stringify(result),candidate,tree,runId});
  assert.deepEqual(verify(result),result);
  const receipt=JSON.stringify(result);
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const key=Buffer.alloc(32,0x11),keyId='test1',attempt='1';
  const repository='lasrevinu333-design/memphis-zoo-mcp';
  const workflowRef=repository+'/.github/workflows/production-backup-migration-rehearsal.yml@refs/heads/test';
  const attestation={repository,workflow_ref:workflowRef,workflow_sha:candidate,run_id:runId,run_attempt:attempt,
    backup_run_id:current429.runId,receipt_sha256:digest(receipt),result_sha256:digest(stableJson(result)),
    result_completed_at:result.completed_at,attested_at:'2026-11-25T20:30:01Z'};
  const envelope={format:'memphis-zoo-release-migration-rehearsal-attestation.v1',algorithm:'hmac-sha256',
    key_id:keyId,attestation,signature:signBinding(releaseMigrationRehearsalAttestationBinding(attestation),key)};
  const input={receipt,envelope,key,keyId,candidate,tree,runId,attempt,workflowRef,now:Date.parse('2026-11-25T20:31:00Z')};
  assert.deepEqual(verifySignedCurrent429Receipt(input),result.current429_target_capture.target);
  assert.throws(()=>verifySignedCurrent429Receipt({...input,attempt:'2'}));
  assert.throws(()=>verifySignedCurrent429Receipt({...input,receipt:receipt+'\n'}));
  assert.throws(()=>verifySignedCurrent429Receipt({...input,key:Buffer.alloc(32,0x22)}));

  for (const mutate of [
    result=>result.source_commit='e'.repeat(40),
    result=>result.backup_run_id='1',
    result=>result.cleanup_checked=false,
    result=>result.scratch.volume_removed=false,
    result=>result.scratch.final.pgdata.filesystem_type='tmpfs',
    result=>{
      const target=result.current429_target_capture.target;
      for(const day of target.current_chicago_week)delete day.coverage_version;
      target.current_chicago_week_coverage=summarizeCurrentWeekCoverage(target.current_chicago_week);
    },
    result=>{
      const target=result.current429_target_capture.target;
      target.current_chicago_week[3].projection_status='unavailable';
      target.current_chicago_week_coverage=summarizeCurrentWeekCoverage(target.current_chicago_week);
    },
    result=>result.current429_target_capture.rollback_verified=false,
    result=>result.current429_target_capture.target.event_guards_preserved=false,
    result=>result.current429_target_capture.target.ledger_count=432,
    result=>result.current429_target_capture.target.catalog.fingerprint=current429.sourceCatalog,
  ]){
    const changed=structuredClone(result);
    mutate(changed);
    assert.throws(()=>verify(changed));
  }
});

test('lost 429 COMMIT acknowledges only an independent read of its original transaction', async t=>{
 const attempt={schema:'custodial.current429-original-migration-commit.v1',postgres_transaction_id:'490',retry_safe:false};
 const directory=mkdtempSync(join(tmpdir(),'custodial-429-commit-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 prepareOriginalMigrationReceipt(attempt,directory);
 const db=new EventEmitter(),submissions=[];
 db.query=sql=>{submissions.push(sql);queueMicrotask(()=>db.emit('error',new Error('lost receipt')));return new Promise(()=>{});};
 db.end=async()=>{};
 let verified=false;
 const observer={connect:async()=>{},end:async()=>{},query:async(sql,params)=>{
   assert.ok(verified);assert.match(sql,/pg_xact_status/);assert.deepEqual(params,['490']);
   return {rowCount:1,rows:[{status:'committed'}]};
 }};
 const result=await commitPreparedCurrent429({db,attempt,directory,createObserver:()=>observer,
   assertIdentity:async(client,options)=>{assert.equal(client,observer);assert.equal(options.migrationAuthority,true);verified=true;}});
 assert.deepEqual(submissions,['commit']);
 assert.deepEqual(result,{acknowledged:false,readback:'COMMITTED'});
 const saved=JSON.parse(readFileSync(join(directory,'current429-production-migration-commit-unknown.json')));
 assert.equal(saved.original_transaction_readback,'COMMITTED');assert.equal(saved.retry_safe,false);
});

test('an acknowledged 429 COMMIT does not open an observer',async()=>{
 const db={query:async(sql)=>{assert.equal(sql,'commit');return {command:'COMMIT'};}};
 assert.deepEqual(await commitPreparedCurrent429({db,createObserver:()=>assert.fail('unexpected observer')}),{acknowledged:true,readback:null});
});
