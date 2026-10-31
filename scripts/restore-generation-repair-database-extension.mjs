// Root-owned source303 plus frozen repair proposals only. No pool, database,
// socket, process, provider, restore/import runner or activation is created here.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {verifyRestoredLeadershipGeneration} from './leadership-restore-generation.mjs';

const sharedRegistration='c7200000-0000-4000-8000-000000000002';
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshotSql=`select
 (select to_jsonb(c) from custodial_dr.restore_control c where singleton) control,
 (select count(*)::text from custodial_leadership_private.registrations) registration_count,
 (select encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by registration_id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
  from custodial_leadership_private.registrations r) registrations_sha256,
 custodial_leadership_private.session_view($1::uuid) session`;
const observedSql=`select
 (select authority_invalidated from custodial_dr.restore_manifests where restore_id=$2::uuid) legacy_authority_invalidated,
 (select count(*)::text from custodial_leadership_private.registrations r
  where r.revoked_at is null and r.authority_generation >= $3::bigint) unsafe_generation_count,
 custodial_leadership_private.session_view($1::uuid) is null as registration_denied,
 (select (custodial_leadership_private.runtime('session',jsonb_build_object('token_hash',r.token_hash,'browser_hash',r.browser_hash))->'data')='null'::jsonb
  from custodial_leadership_private.registrations r where registration_id=$1::uuid) opaque_cookie_readback_denied,
 pg_backend_pid() as backend_pid,
 current_setting('session_replication_role') as trigger_mode`;

export async function run({fixture,pool,cohort,save,assertFrozen,sourceCurrent}){
 assert.equal(typeof fixture?.assertOwned,'function');assert.equal(typeof pool?.connect,'function');
 assert.equal(typeof save,'function');assert.equal(typeof assertFrozen,'function');
 assert.equal(fixture.receipt?.selected_replay?.migrations,303);
 assert.ok(fixture.socketDirectory?.startsWith('/'));assert.equal(pool.options.host,fixture.socketDirectory);
 assert.equal(cohort?.manager?.credential_id,sharedRegistration,'Original committed c720 cohort fixture required');
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGPASSWORD','STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL'])
  assert.equal(process.env[key],undefined,'Ambient target refused: '+key);
 const current=async()=>{assertFrozen();sourceCurrent?.();await fixture.assertOwned();};
 await current();
 const restoreId=randomUUID(),checks=[],helperCalls=[];let sequence=0,transactionOpen=false,rollbackVerified=false,primaryError=null;
 const client=await pool.connect();
 const mark=(name,details={})=>{const check={name,status:'PASS',...details};checks.push(check);save('RESTORE_GENERATION_CHECK_'+String(checks.length).padStart(3,'0')+'.json',check);};
 const query=async(sql,args=[])=>{await current();return client.query(sql,args);};
 const callHelper=async(label,input={restoreId,generation},reject=false)=>{
  await current();const n=String(++sequence).padStart(3,'0');
  save('RESTORE_GENERATION_HELPER_'+n+'_BEFORE.json',{label,input,expected:reject?'REFUSED':'RESTORED_REGISTRATIONS_DENIED',sameClient:true});
  try{
   // Actual exported source, real owning pg client and SQL result. No query mock.
   const result=await verifyRestoredLeadershipGeneration(client,input);
   save('RESTORE_GENERATION_HELPER_'+n+'_RETURNED.json',{label,result});
   helperCalls.push({label,outcome:'RETURNED',result});
   assert.equal(reject,false,'Unsafe helper input unexpectedly accepted: '+label);
   assert.equal(result.outcome,'RESTORED_REGISTRATIONS_DENIED');return result;
  }catch(error){
   if(!reject||error.code==='ERR_ASSERTION')throw error;
   assert.match(error.message,/Restored leadership authority remains unverified/);
   const result={label,outcome:'REFUSED',code:error.code??null,message:error.message};
   save('RESTORE_GENERATION_HELPER_'+n+'_REFUSED.json',result);helperCalls.push(result);return result;
  }
 };
 let generation,original,binding,backendPid;
 try{
  const connection=(await query(`select pg_backend_pid() backend_pid,current_user::text current_user,session_user::text session_user,
   current_setting('session_replication_role') trigger_mode`)).rows[0];
  assert.ok(['postgres','supabase_admin'].includes(connection.session_user));assert.equal(connection.current_user,connection.session_user);
  assert.equal(connection.trigger_mode,'origin');backendPid=connection.backend_pid;
  original=(await query(snapshotSql,[sharedRegistration])).rows[0];
  assert.ok(original?.control&&original.session);assert.equal(original.control.mutations_paused,false);
  assert.ok(['READY','COMPLETE'].includes(original.control.state));
  const priorGeneration=Number(original.control.authority_generation);
  assert.ok(Number.isSafeInteger(priorGeneration)&&priorGeneration>=0&&priorGeneration<Number.MAX_SAFE_INTEGER-2);
  generation=priorGeneration+1;
  assert.equal(original.session.registrationId,sharedRegistration);
  assert.equal(original.session.cohort.principalId,cohort.manager.manager_id);
  assert.equal(original.session.claimedAccount.accountId,cohort.manager.claimed_manager_id);
  binding=(await query(`select authority_generation::text,revoked_at::text from custodial_leadership_private.registrations where registration_id=$1`,[sharedRegistration])).rows[0];
  assert.equal(binding.authority_generation,String(priorGeneration));assert.equal(binding.revoked_at,null);
  assert.equal((await query('select count(*)::int n from custodial_dr.restore_manifests where restore_id=$1',[restoreId])).rows[0].n,0);
  save('RESTORE_GENERATION_ORIGINAL.json',{backendPid,restoreId,priorGeneration,generation,
   control_sha256:fingerprint(original.control),registrations_sha256:original.registrations_sha256,
   registration_count:original.registration_count,session_sha256:fingerprint(original.session),sameClient:true,triggerMode:'origin'});
  mark('ready protected generation and current original c720 registration observed on owned client');

  await query('begin');transactionOpen=true;
  await query("set local statement_timeout='5000ms'");await query("set local lock_timeout='3000ms'");
  await query("set local idle_in_transaction_session_timeout='30000ms'");
  const paused=await query(`update custodial_dr.restore_control set authority_generation=$1,mutations_paused=true,state='VERIFYING',restore_id=$2
   where singleton and authority_generation=$3 and not mutations_paused and state in('READY','COMPLETE')`,[generation,restoreId,priorGeneration]);
  assert.equal(paused.rowCount,1);
  await query(`insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest,authority_invalidated)
   values($1,$2,$3,true)`,[restoreId,generation,'f'.repeat(64)]);
  const observed=(await query(observedSql,[sharedRegistration,restoreId,generation])).rows[0];
  assert.deepEqual(observed,{legacy_authority_invalidated:true,unsafe_generation_count:'0',registration_denied:true,
   opaque_cookie_readback_denied:true,backend_pid:backendPid,trigger_mode:'origin'});
  mark('actual old registration and opaque-cookie runtime readback denied despite legacy completion flag true',observed);
  const accepted=await callHelper('old-generation restored registrations denied');
  assert.equal(accepted.registration_count,Number(original.registration_count));
  mark('actual exported completion helper accepts the matching paused generation and fully invalidated old set',accepted);

  await callHelper('wrong original restore identity',{restoreId:randomUUID(),generation},true);
  await callHelper('wrong protected generation',{restoreId,generation:generation+1},true);
  mark('actual helper rejects wrong restore ownership and protected generation');

  for(const [label,unsafeGeneration] of [['current',generation],['future',generation+1]]){
   const changed=await query('update custodial_leadership_private.registrations set authority_generation=$2 where registration_id=$1',[sharedRegistration,unsafeGeneration]);
   assert.equal(changed.rowCount,1);
   const unsafe=(await query(observedSql,[sharedRegistration,restoreId,generation])).rows[0];
   assert.equal(unsafe.legacy_authority_invalidated,true);assert.equal(unsafe.unsafe_generation_count,'1');
   assert.equal(unsafe.registration_denied,true);assert.equal(unsafe.opaque_cookie_readback_denied,true);
   assert.equal(unsafe.backend_pid,backendPid);assert.equal(unsafe.trigger_mode,'origin');
   await callHelper(label+'-generation unrevoked row',{restoreId,generation},true);
   mark('actual helper rejects unrevoked '+label+'-generation authority even though pause currently denies its session',unsafe);
  }
  // A genuine revoked row cannot authenticate later; verify that the helper
  // distinguishes it from the unrevoked future-generation counterexample.
  await query('update custodial_leadership_private.registrations set revoked_at=clock_timestamp() where registration_id=$1',[sharedRegistration]);
  await callHelper('revoked future-generation row remains invalidated');
  mark('actual helper accepts an explicitly revoked row without confusing it with live future authority');
  await query('update custodial_leadership_private.registrations set authority_generation=$2,revoked_at=null where registration_id=$1',[sharedRegistration,priorGeneration]);

  await query('savepoint missing_protected_generation');
  assert.equal((await query('delete from custodial_dr.restore_control where singleton')).rowCount,1);
  assert.equal((await query('select custodial_leadership_private.session_view($1::uuid) is null denied',[sharedRegistration])).rows[0].denied,true);
  await callHelper('protected generation unavailable',{restoreId,generation},true);
  await query('rollback to savepoint missing_protected_generation');await query('release savepoint missing_protected_generation');
  mark('actual helper and session reader fail closed when protected singleton is unavailable');
  await callHelper('reconciled old set before final rollback');
  await query('rollback');transactionOpen=false;

  const restored=(await query(snapshotSql,[sharedRegistration])).rows[0];
  assert.deepEqual(restored,original,'Rollback must restore exact protected control, registration rows and current session');
  assert.equal((await query('select count(*)::int n from custodial_dr.restore_manifests where restore_id=$1',[restoreId])).rows[0].n,0);
  const finalConnection=(await query("select pg_backend_pid() backend_pid,current_setting('session_replication_role') trigger_mode")).rows[0];
  assert.deepEqual(finalConnection,{backend_pid:backendPid,trigger_mode:'origin'});
  rollbackVerified=true;
  save('RESTORE_GENERATION_ROLLBACK_VERIFIED.json',{status:'PASS',backendPid,control_sha256:fingerprint(restored.control),
   registrations_sha256:restored.registrations_sha256,registration_count:restored.registration_count,
   session_sha256:fingerprint(restored.session),syntheticManifestAbsent:true,originalCurrentSessionRestored:true,triggerMode:'origin'});
  mark('rollback removes synthetic restore metadata and restores exact original rows and current cohort session');
 }catch(error){
  primaryError=error;save('RESTORE_GENERATION_EXTENSION_FAILURE.json',{status:'FAIL',code:error.code??null,message:error.message,
   transactionOpen,rollbackVerified,helperCalls});throw error;
 }finally{
  let cleanupError=null;
  try{
   if(transactionOpen){
    try{await client.query('rollback');transactionOpen=false;save('RESTORE_GENERATION_FAILURE_ROLLBACK.json',{status:'RETURNED'});}
    catch(error){cleanupError=error;save('RESTORE_GENERATION_FAILURE_ROLLBACK.json',{status:'UNKNOWN',code:error.code??null,message:error.message});}
   }
  }finally{
   // The pool/resource owner is root; release only this extension's leased client.
   // A failed or uncertain client is discarded by the pool, never reused.
   client.release(primaryError||cleanupError||undefined);
  }
  if(cleanupError&&!primaryError)throw cleanupError;
 }

 await current();
 const result={status:'PASS',scope:'ROOT_OWNED_ACTUAL_COMPLETION_HELPER_REAL_SQL_ROLLBACK_ONLY',checks,helperCalls,
  backendPid,rollbackVerified,production:false,restoreExecuted:false,importExecuted:false,activationExecuted:false,
  socketsOpened:0,createdPools:0,createdDatabases:0,independentAcceptance:false};
 save('RESTORE_GENERATION_EXTENSION_RESULT.json',result);return result;
}
