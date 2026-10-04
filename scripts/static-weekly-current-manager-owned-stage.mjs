// Invoked only by the explicit current-manager-owned-219 isolated stage.
// Cold migration replay, accepted publication, clone, HTTP operation, SQL
// readback and cleanup share the parent process-start one-minute clock.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {runOwnedRecurringOperation} from '../src/static-weekly-recurring-operation-owner.js';
import {recurringOperationSourceManifest} from '../src/static-weekly-recurring-operation-source.js';
import {createCurrentManager219OwnedCheckpoint,planCurrentManager219RehearsalClone,
 assertCurrentManager219CloneReadback} from './static-weekly-current-manager-owned-checkpoint.mjs';

const IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const CHILD=new URL('./static-weekly-current-manager-owned-checkpoint-child.mjs',import.meta.url);
const SOURCE_DB='postgres';
const WORK_DEADLINE_MS=50_000; // Ten seconds remain for exact group/container/socket cleanup.
const TOTAL_DEADLINE_MS=60_000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const closed=(value,keys)=>{
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
 return value;
};

export function remainingOwnedAttempt(now=()=>performance.now(),reserveMilliseconds=10_000){
 assert.ok(Number.isSafeInteger(reserveMilliseconds)&&reserveMilliseconds>=0&&reserveMilliseconds<60_000);
 return Math.max(0,Math.floor(TOTAL_DEADLINE_MS-now()-reserveMilliseconds));
}

export async function closeOwnedReadbackPool(pool,{now=()=>performance.now(),setTimer=setTimeout,
 clearTimer=clearTimeout}={}){
 const budget=Math.floor(TOTAL_DEADLINE_MS-now()-5_000);
 if(budget<1)throw new Error('owned SQL pool settlement has no time before exact container cleanup');
 let timer;
 try{
  await Promise.race([pool.end(),new Promise((_,reject)=>{
   timer=setTimer(()=>reject(new Error('owned SQL pool settlement unknown at cleanup reserve')),budget);
  })]);
 }finally{if(timer!==undefined)clearTimer(timer);}
}

// beginBoundedManagerRequest adds 60 seconds at ingress. This test-only clock
// supplies the *same earlier* monotonic deadline, never a fresh allowance.
export function managerClockForExistingAttempt(deadlineAt,{now=()=>performance.now(),setTimer=setTimeout,
 clearTimer=clearTimeout}={}){
 assert.ok(Number.isFinite(deadlineAt)&&deadlineAt<=TOTAL_DEADLINE_MS);
 return Object.freeze({now:()=>deadlineAt-60_000,
  setTimer:(callback)=>setTimer(callback,Math.max(1,Math.floor(deadlineAt-now()-5_000))),
  clearTimer});
}

async function actualCloneReadback({pool,checkpoint,plan,now}){
 const q=async(sql,args=[])=>{
  const timeout=remainingOwnedAttempt(now);
  assert.ok(timeout>0,'clone readback cannot extend the original attempt');
  const result=await pool.query({text:sql,values:args,query_timeout:timeout});return result.rows[0]?.result;
 };
 const p=checkpoint.publication;
 assert.equal(await q('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[p.currentSourceId]),p.currentSourceDigest);
 assert.equal(await q('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[p.originalSourceId]),p.originalSourceDigest);
 assert.equal(await q('select version_id as result from public.weekly_schedule_publications where publication_id=$1',[p.publicationId]),p.versionId);
 const projection=await q('select projection_envelope as result from public.weekly_schedule_compiled_projections where projection_id=$1',[p.projectionId]);
 assert.ok(projection&&typeof projection==='object');
 assert.equal(projection.authority?.compilerInput?.version?.assignments?.length,323);
 assert.equal(projection.authority?.overlayCompilerInput?.version?.assignments?.length,p.acceptedRows);
 assert.equal(await q('select current_revision::integer as result from public.static_weekly_schedule_control where singleton'),p.authorityRevision);
 assert.equal(await q('select count(*)::integer as result from public.weekly_schedule_slot_assignments where version_id=$1',[p.versionId]),p.acceptedRows);
 assert.equal(await q('select md5(jsonb_agg(to_jsonb(a) order by assignment_id)::text) as result from public.weekly_schedule_slot_assignments a where version_id=$1',[p.versionId]),p.relationalDigest);
 const lunch=await q('select document_json as result from public.weekly_schedule_lunch_documents where projection_id=$1',[p.projectionId]);
 assert.equal(lunch?.document_identity,p.lunchIdentity);assert.equal(lunch?.loans?.length,p.lunchLoans);
 for(const expected of p.dates){
  const date=expected.date;
  const roster=await q("select coalesce(jsonb_agg(to_jsonb(r)),'[]') as result from public.static_weekly_v6_read_roster($1::date) r",[date]);
  const dayLunch=await q('select public.static_weekly_v8_read_lunch_document($1::date) as result',[date]);
  const state=await q('select projection_status as result from public.static_weekly_v6_schedule_authority_state($1::date)',[date]);
  assert.equal(state,expected.projectionStatus);assert.equal(dayLunch?.projection_id,expected.projectionId);
  assert.equal(dayLunch?.document_identity,expected.lunchIdentity);
  assert.equal(roster?.length,expected.rosterCount);assert.equal(dayLunch?.loans?.length,expected.loanCount);
 }
 const grants=await q("select count(*)::integer as result from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)");
 assert.equal(grants,0);
 assert.equal(await q('select count(*)::integer as result from public.static_weekly_recurring_confirmations'),0);
 // Every checkpoint field above was checked against the clone. This closed
 // receipt is still local synthetic SQL proof, not a production source.
 return assertCurrentManager219CloneReadback(checkpoint,plan,{database:plan.database,
  containerId:plan.containerId,migrationManifestDigest:checkpoint.basis.migrationManifestDigest,
  operationSourceDigest:checkpoint.basis.operationSource.digest,
  fixtureSha256:checkpoint.basis.fixtureSha256,publication:p,defaultApiGrants:grants});
}

export async function runCurrentManagerOwned219Stage({container,socket,containerId,docker,sql,
 now=()=>performance.now(),runOwned=runOwnedRecurringOperation,loadPg=()=>import('pg'),
 httpStage=null,cloneReadback=actualCloneReadback,produceCheckpoint=null,emit=console.log}={}){
 assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
 assert.match(socket??'',/^\/tmp\/mz-shift-socket-[A-Za-z0-9]+$/);
 assert.match(containerId??'',/^[a-f0-9]{64}$/);
 assert.equal(typeof docker,'function');assert.equal(typeof sql,'function');
 assert.ok(remainingOwnedAttempt(now)>0,'one absolute attempt has no work budget after replay');
 const dir=mkdtempSync('/tmp/mz-manager-owned-'),output=dir+'/checkpoint.json',failure=dir+'/failure.json';
 let pool=null,primaryError=null;
 try{
  const source=recurringOperationSourceManifest();
  const childDigest=sha(readFileSync(CHILD));
  let result;
  try{result=produceCheckpoint?await produceCheckpoint({output,deadlineAt:WORK_DEADLINE_MS,sourceDigest:source.digest})
   :await runOwned({childFile:CHILD,childDigest,sourceDigest:source.digest,
   input:{stage:'current-manager-owned-219'},validateInput:input=>closed(input,['stage']),
   validateReceipt:receipt=>{closed(receipt,['checkpointDigest']);assert.match(receipt.checkpointDigest,/^[a-f0-9]{64}$/);return receipt;},
   deadlineAt:WORK_DEADLINE_MS,now,
   onLaunch:fact=>emit('OWNED_219_PROVISIONAL',JSON.stringify(fact)),
   onCustody:fact=>emit('OWNED_219_CUSTODY',JSON.stringify(fact)),
   launch:file=>fork(file,[],{detached:true,serialization:'advanced',stdio:['ignore','inherit','inherit','ipc'],
    env:{...process.env,SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket,
     STATIC_WEEKLY_TEST_CURRENT_219:'1',STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_219:'1',
     STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_CHILD:'1',STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_OUTPUT:output,
     STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_FAILURE_OUTPUT:failure}})});
  }catch(error){
   try{const fact=JSON.parse(readFileSync(failure,'utf8'));
    closed(fact,['status','phase','code','errorClass','childElapsedMilliseconds']);
    emit('OWNED_219_PUBLICATION_FAILURE',JSON.stringify(fact));
   }catch{emit('OWNED_219_PUBLICATION_FAILURE_FACT_UNAVAILABLE');}
   throw error;
  }
  assert.equal(result.groupAbsent,true);
  const checkpoint=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(checkpoint.digest,result.receipt.checkpointDigest);
  assert.equal(checkpoint.environment.containerId,containerId);
  assert.equal(checkpoint.environment.image,IMAGE);
  const sourceSessions=Number(sql("select count(*) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()"));
  assert.equal(sourceSessions,0,'clone requires no source sessions');
  const suffix=randomBytes(6).toString('hex');
  const plan=planCurrentManager219RehearsalClone(checkpoint,{suffix,sourceSessions});
  assert.ok(remainingOwnedAttempt(now)>0,'clone cannot start after the original work deadline');
  const cloneOutput=docker(plan.argv.slice(1),{timeout:Math.max(1,remainingOwnedAttempt(now))});
  assert.equal(typeof cloneOutput,'string');
  emit('OWNED_219_EXACT_CLONE',plan.database,plan.digest);
  const {Pool}=await loadPg();
  assert.ok(remainingOwnedAttempt(now)>0,'clone SQL readback cannot start after the original work deadline');
  pool=new Pool({connectionString:plan.rehearsalUrl,ssl:false,max:3,
   connectionTimeoutMillis:Math.min(5000,remainingOwnedAttempt(now))});
  const adapter=await cloneReadback({pool,checkpoint,plan,now});
  assert.equal(adapter.classification,'CALLER_READBACK_MATCHED_NOT_SQL_EXECUTION_PROOF');
  emit('OWNED_219_CLONE_SQL_READBACK',checkpoint.digest,plan.digest);
  assert.ok(remainingOwnedAttempt(now)>0,'HTTP preview and confirmation cannot start after original work deadline');
  const previousUrl=process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL;
  const previousLoopback=process.env.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL;
  process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL=adapter.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL;
  process.env.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL='1';
  try{
   const runHttp=httpStage||(await import('./static-weekly-recurring-confirmation-http-integration.mjs')).testRecurringConfirmationHttp;
   const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);emit('PASS',label);};
   const proof=await runHttp({pool,week:checkpoint.publication.week,
    originalManagerId:checkpoint.publication.managerId,check,
    managerOperationClock:managerClockForExistingAttempt(WORK_DEADLINE_MS,{now}),
    attemptRemainingMilliseconds:()=>remainingOwnedAttempt(now)});
   assert.ok(remainingOwnedAttempt(now)>0,'accepted HTTP readback and teardown exceeded the original work deadline');
   return Object.freeze({status:'PASS',classification:'SYNTHETIC_LOCAL_OPERATION_OWNED_NOT_RELEASE',
    checkpointDigest:checkpoint.digest,clonePlanDigest:plan.digest,
    operationReceipt:proof?.receipt,phoneDeliveryState:proof?.receipt?.phoneDeliveryState,
    allGroupsAbsent:true});
  }finally{
   if(previousUrl===undefined)delete process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL;
   else process.env.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL=previousUrl;
   if(previousLoopback===undefined)delete process.env.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL;
   else process.env.STATIC_WEEKLY_CONTROL_PLANE_ALLOW_INSECURE_LOOPBACK_REHEARSAL=previousLoopback;
  }
 }catch(error){primaryError=error;throw error;
 }finally{
  let cleanupError=null;
  try{if(pool)await closeOwnedReadbackPool(pool,{now});}catch(error){cleanupError=error;}
  try{
   for(const file of [output,failure])try{unlinkSync(file);}catch(error){if(error?.code!=='ENOENT')throw error;}
   rmdirSync(dir);
  }catch(error){cleanupError??=error;}
  // A successful readback is not a successful attempt while the caller-owned
  // SQL pool is still being torn down. The outer runner separately proves
  // exact container/socket removal before it emits its final receipt.
  if(now()>=TOTAL_DEADLINE_MS)cleanupError??=new Error('owned SQL pool cleanup exceeded the original attempt');
  if(cleanupError){emit('OWNED_219_POOL_CLEANUP_UNPROVEN');if(!primaryError)throw cleanupError;}
 }
}
