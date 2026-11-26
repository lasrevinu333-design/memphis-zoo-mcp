import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {stableJson,stableJsonFileSha256,requireSigningKey,verifyBinding,releaseMigrationRehearsalAttestationBinding} from './disaster-recovery-crypto.mjs';
import {validateProductionDatabaseUrl,assertProductionDatabaseIdentity} from './production-database-identity.mjs';
import {captureCatalogFromSnapshot} from './schema-catalog-readonly-client.mjs';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {ledgerMetadataDigest} from './backup-ledger-binding-v2.mjs';
import {NATIVE_TEXT_PRESERVATION_SETTINGS} from './isolated-release-data-preservation.mjs';
import {current429,readCurrent429Plan} from './current429-forward-qualification-source.mjs';
import {assertCurrent429CatalogDelta,readCurrent429Registry} from './current429-forward-readback.mjs';
import {readCurrentWeek,restoreCurrent429ProofBudgets} from './current428-rollback-target.mjs';
import {verifyCurrent429Result} from './verify-current429-rehearsal.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const repository='lasrevinu333-design/memphis-zoo-mcp';
const workflowPrefix=repository+'/.github/workflows/production-backup-migration-rehearsal.yml@';
const ledgerSql='select version::text,name::text,statements from supabase_migrations.schema_migrations order by version';
const applicationLocks=['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence'];
const publicTableNamesSql=`select format('%I.%I',n.nspname,c.relname) name from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by n.nspname,c.relname`;

export function verifySignedCurrent429Receipt({receipt,envelope,key,keyId,candidate,tree,runId,attempt,workflowRef,now=Date.now()}){
  const result=verifyCurrent429Result({receipt,candidate,tree,runId});
  const proof=envelope?.attestation;
  assert.equal(envelope.format,'memphis-zoo-release-migration-rehearsal-attestation.v1');
  assert.equal(envelope.algorithm,'hmac-sha256');
  assert.equal(envelope.key_id,keyId);
  assert.ok(verifyBinding(releaseMigrationRehearsalAttestationBinding(proof),envelope.signature,key));
  assert.ok(workflowRef.startsWith(workflowPrefix));
  assert.equal(proof.repository,repository);
  assert.equal(proof.workflow_ref,workflowRef);
  assert.equal(proof.workflow_sha,candidate);
  assert.equal(proof.run_id,runId);
  assert.equal(proof.run_attempt,attempt);
  assert.equal(proof.backup_run_id,current429.runId);
  assert.equal(proof.receipt_sha256,sha(receipt));
  assert.equal(proof.result_sha256,sha(stableJson(result)));
  assert.equal(proof.result_completed_at,result.completed_at);
  const finished=Date.parse(result.completed_at);
  const attested=Date.parse(proof.attested_at);
  assert.ok(Number.isFinite(finished)&&Number.isFinite(attested)&&
    finished<=attested&&attested<=now&&now-finished<24*60*60*1000);
  return result.current429_target_capture.target;
}

async function configureSnapshot(query){
  await query('set local search_path=pg_catalog,public,extensions');
  for(const [setting,value] of NATIVE_TEXT_PRESERVATION_SETTINGS)
    await query('select set_config($1,$2,true)',[setting,value]);
}

async function readSnapshot(query, db){
  const ledger=(await query(ledgerSql)).rows;
  const catalog=await captureCatalogFromSnapshot(db);
  return {ledger,catalog,ledgerHash:stableJsonFileSha256(ledger),
    catalogHash:fingerprintSchemaCatalog(catalog).fingerprint};
}

function verifyTarget(snapshot, target, plan){
  assert.equal(snapshot.ledger.length,plan.expected_target_ledger_count);
  assert.equal(snapshot.ledger.at(-1)?.version,plan.expected_target_ledger_head);
  assert.equal(snapshot.ledgerHash,target.ledger_sha256);
  assert.equal(snapshot.catalogHash,target.catalog.fingerprint);
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot.catalog).map(([name,rows])=>[name,rows.length])),target.catalog.counts);
}

// Session locks precede BEGIN so the snapshot cannot miss a lease that
// completed while this connection waited for exclusive admission.
export async function beginCurrent429ApplyTransaction(query, enumerateTables){
  await query("set lock_timeout='5s'");
  await query("set statement_timeout='180s'");
  for(const name of ['memphis-zoo-release-migration-plan',...applicationLocks])
    await query('select pg_advisory_lock(hashtextextended($1,0))',[name]);
  const tables=await enumerateTables?.();
  await query('begin isolation level serializable');
  return tables;
}

export async function releaseCurrent429ApplicationLocks(query) {
  for(const name of [...applicationLocks].reverse()){
    const released=await query('select pg_advisory_unlock(hashtextextended($1,0)) unlocked',[name]);
    assert.equal(released.rows[0]?.unlocked,true,'Exact production mutation lock release required');
  }
}

async function readScheduleDay(query){
  const result=await query(`with day as (select public.sch_service_date(now()) as service_date), readback as (
    select service_date, public.custodial_memphis_schedule_day(service_date)::jsonb as data from day
  ) select service_date::text,data->>'status' as status,jsonb_array_length(data->'rows') as roster_rows,
    data->>'publication_id' is not null as published,data->>'projection_id' is not null as projection_bound from readback`);
  assert.equal(result.rowCount,1);
  const schedule=result.rows[0];
  assert.ok(schedule.status==='current'&&schedule.published&&schedule.projection_bound
    &&Number.isSafeInteger(schedule.roster_rows)&&schedule.roster_rows>0,'Usable published service day required');
  return schedule;
}

async function apply(){
  let stage='authorization',db,transaction=false,committed=false,commitRequested=false;
  const started=performance.now();
  let stageStarted=started;
  const enter=next=>{stage=next;stageStarted=performance.now();};
  try{
    assert.equal(process.env.GITHUB_ACTIONS,'true');
    assert.equal(process.env.GITHUB_REPOSITORY,repository);
    // One user-authorized rehearsal, one conditional deployment. GitHub reruns
    // cannot treat a prior attempt's receipt as authority.
    assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
    assert.equal(process.env.CURRENT429_PRODUCTION_APPLY,'true');
    assert.equal(process.env.CURRENT429_PROJECT_CONFIRMATION,current429.projectRef);
    const candidate=process.env.GITHUB_SHA;
    assert.equal(candidate,process.env.CURRENT429_EXPECTED_CANDIDATE);
    const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
    assert.equal(git('rev-parse','HEAD'),candidate);
    assert.equal(git('status','--porcelain'),'');
    const tree=git('rev-parse','HEAD^{tree}');
    const folder=resolve(process.env.CURRENT429_SIGNED_REHEARSAL_DIR);
    const target=verifySignedCurrent429Receipt({
      receipt:readFileSync(resolve(folder,'production-backup-migration-rehearsal.jsonl'),'utf8'),
      envelope:JSON.parse(readFileSync(resolve(folder,'production-backup-migration-rehearsal-attestation.json'),'utf8')),
      key:requireSigningKey(process.env.RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY,'RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY'),
      keyId:process.env.RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY_ID,
      candidate,tree,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,workflowRef:process.env.GITHUB_WORKFLOW_REF,
    });
    const plan=readCurrent429Plan();
    enter('physical_production_identity');
    const {connectionString}=validateProductionDatabaseUrl(process.env.SUPABASE_DB_URL,current429.projectRef);
    db=new pg.Client({connectionString,connectionTimeoutMillis:10000,
      ssl:{ca:readFileSync(process.env.SUPABASE_DB_CA_CERT_PATH,'utf8'),rejectUnauthorized:true},
      application_name:'custodial-429-reviewed-forward'});
    await db.connect();
    await assertProductionDatabaseIdentity(db,{migrationAuthority:true});
    const query=(statement,params)=>db.query(statement,params);
    enter('locked_production_baseline');
    const tables=await beginCurrent429ApplyTransaction(query,()=>query(publicTableNamesSql));
    transaction=true;
    assert.ok(tables.rowCount>0);
    await query('lock table supabase_migrations.schema_migrations in access exclusive mode');
    // Freeze direct public writes and DDL while allowing ordinary Schedule
    // and other readers. None of the four reviewed bodies changes a public
    // table. The exact catalog delta and private registry proof below enforce
    // that scope independently of the rehearsal.
    await query(`lock table ${tables.rows.map(row=>row.name).join(',')} in share mode`);
    // LOCK is a utility command. Acquire all relation locks before issuing
    // SELECT/set_config and therefore before the serializable snapshot.
    await configureSnapshot(query);
    assert.deepEqual((await query(publicTableNamesSql)).rows,tables.rows,'Public table inventory changed before its locks were admitted');
    const authority=await query(`select state,mutations_paused,
      (select count(*)::int from custodial_dr.application_mutation_leases) leases
      from custodial_dr.restore_control where singleton`);
    assert.equal(authority.rowCount,1);
    assert.equal(authority.rows[0].mutations_paused,false);
    assert.equal(authority.rows[0].leases,0);
    assert.ok(['READY','COMPLETE'].includes(authority.rows[0].state));
    const before=await readSnapshot(query,db);
    assert.equal(before.ledger.length,current429.sourceCount);
    assert.equal(before.ledger.at(-1)?.version,current429.sourceHead);
    assert.equal(before.ledgerHash,current429.sourceLedgerSha256);
    assert.equal(ledgerMetadataDigest(before.ledger.map(row=>({...row,statement_sha256:row.statements.map(sha)}))),current429.sourceTupleSha256);
    assert.equal(before.catalogHash,current429.sourceCatalog);
    const registryBefore=await readCurrent429Registry(query,'before');
    assert.equal(registryBefore.event_guard_sha256,target.event_guard_sha256);
    enter('verify_frozen_schedule_before_apply');
    const weekBefore=await readCurrentWeek(query,{requireVersion2:true});
    assert.equal(weekBefore.coverage.working_coverage,true,'Production Chicago week unavailable before apply');
    const scheduleBefore=await readScheduleDay(query);
    enter('execute_four_reviewed_migrations');
    for(const migration of plan.pending){
      await query(migration.body);
      await restoreCurrent429ProofBudgets(query);
      await query(`insert into supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key,rollback)
        values($1,$2::text[],$3,$4,null,null)`,[
        migration.version,[migration.sql],migration.file.slice(15,-4),'Custodial signed four-migration workflow '+process.env.GITHUB_RUN_ID,
      ]);
    }
    enter('verify_target_before_commit');
    const after=await readSnapshot(query,db);
    verifyTarget(after,target,plan);
    assert.deepEqual(after.ledger.slice(0,current429.sourceCount),before.ledger);
    assertCurrent429CatalogDelta(before.catalog,after.catalog);
    assert.deepEqual(await readCurrent429Registry(query,'after'),registryBefore);
    // The signed rehearsal already executed the exact week reader on both
    // sides of these exact bodies. This transaction has a frozen public
    // snapshot, a pinned source catalog and the same reviewed definition,
    // ACL and private-registry delta. Retain the narrower in-lock operational
    // day comparison and run the full fresh week after releasing admission.
    assert.deepEqual(await readScheduleDay(query),scheduleBefore);
    enter('commit');
    commitRequested=true;
    assert.equal((await query('commit')).command,'COMMIT');
    committed=true;
    transaction=false;
    enter('release_application_mutation_locks');
    await releaseCurrent429ApplicationLocks(query);
    enter('verify_production_readback');
    await query('begin isolation level repeatable read read only');
    transaction=true;
    await configureSnapshot(query);
    verifyTarget(await readSnapshot(query,db),target,plan);
    assert.deepEqual(await readCurrent429Registry(query,'after'),registryBefore);
    const schedule=await readScheduleDay(query);
    const week=await readCurrentWeek(query,{requireVersion2:true});
    assert.equal(week.coverage.working_coverage,true,'Production Chicago week unavailable on commit readback');
    await query('rollback');
    transaction=false;
    enter('probe_application_http_liveness');
    const response=await fetch('https://memphis-zoo-mcp.onrender.com/schedule-api/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
    const healthy=response.ok&&(await response.json()).ok===true;
    console.log(JSON.stringify({ok:healthy,production_committed:true,production_target_verified:true,
      run_id:process.env.GITHUB_RUN_ID,backup_run_id:current429.runId,plan_sha256:plan.plan_sha256,
      target_ledger_count:target.ledger_count,target_ledger_head:target.ledger_head,
      target_catalog_fingerprint:target.catalog.fingerprint,
      sql_operational_day_0400_chicago:schedule,sql_employee_week_civil_chicago:week.coverage,
      schedule_api_liveness:{http_status:response.status,ok:healthy},protected_phone_schedule:'NOT_PROBED',
      elapsed_ms:Math.round(performance.now()-started)}));
    if(!healthy)process.exitCode=1;
  }catch(error){
    if(transaction&&!committed)await db.query('rollback').catch(()=>{});
    console.error(JSON.stringify({ok:false,stage,production_committed:committed?true:commitRequested?null:false,
      stage_elapsed_ms:Math.round(performance.now()-stageStarted),elapsed_ms:Math.round(performance.now()-started),
      sqlstate:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null}));
    process.exitCode=1;
  }finally{
    await db?.end().catch(()=>{});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await apply();
