import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';

// Runs only inside the existing network-none disposable publication harness.
// Uses real accepted projections, real SQL enqueue/lease validation, and the
// actual HTTP owner's SELECT with an explicitly fixed synthetic clock. The
// closed session is a SQL fixture, NOT authenticated native/physical NFC proof.
export async function prepareScheduleReminderProjectionProof({pool,week,check}) {
 const q=async(sql,args=[])=>(await pool.query(sql,args)).rows[0]?.result;
 const at=week+'T15:00:00.000Z'; // 10:00 America/Chicago in this Sept fixture.
 const row=(await pool.query(`select * from public.custodial_operational_location_assignments($1::date)
  where projection_status='current' and assignment_status='ASSIGNED' and form_type='restroom'
   and coverage_start<='10:00' and coverage_end>'10:00' order by location_id limit 1`,[week])).rows[0];
 assert.ok(row?.projection_id,'actual accepted current projection fixture');
 const device=randomUUID(),credential=randomUUID(),lease=randomUUID(),session=randomUUID();
 const code='SYNTH_REMINDER_'+device.slice(0,8),token='synthetic-local-only-'+credential;
 await pool.query(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values($1,$2,'Synthetic reminder projection phone',true,$3)`,[device,code,row.assigned_employee_id]);
 await pool.query(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
  values($1,$2,$3,statement_timestamp(),$4::timestamptz+interval '30 days')`,[credential,device,createHash('sha256').update(credential).digest('hex'),at]);
 await pool.query(`insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes)
  values($1::uuid,$1::uuid::text,$2,$3,$4,'closed',$5::timestamptz-interval '2 hours 10 minutes',$5::timestamptz-interval '2 hours',10)`,
 [session,row.location_id,row.assigned_employee_id,device,at]);
 await pool.query('select public.mz_register_employee_push($1,$2,$3,\'android\',\'synthetic\',\'synthetic\')',
  [credential,token,createHash('sha256').update(token).digest('hex')]);
 const principal=(await pool.query('select assignment_epoch from public.devices where id=$1',[device])).rows[0];
 const registration=(await pool.query('select registration_id,token_hash from public.employee_push_registrations where credential_id=$1 and active',[credential])).rows[0];
 const rpc=async(name,args)=>{const c=await pool.connect();try{await c.query('begin');await c.query('set local role service_role');
  const result=(await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
  await c.query('commit');return result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}};
 const enqueue=()=>rpc('mz_enqueue_employee_location_pushes',[at]);
 const jobs=async()=> (await pool.query("select * from public.operational_notification_jobs where job_type='employee_native_push' and payload_json->>'credential_id'=$1 order by created_at,job_id",[credential])).rows;
 const leased=async job=>{await pool.query("update public.operational_notification_jobs set status='leased',lease_token=$2,leased_until=$3::timestamptz+interval '1 hour' where job_id=$1",[job.job_id,lease,at]);return rpc('mz_validate_employee_location_reminder',[job.job_id,lease,at]);};
 const source=readFileSync(new URL('../src/messaging-api.js',import.meta.url),'utf8');
 const route=source.indexOf('router.get("/device-location-status-reminders"');
 const start=source.indexOf('const rows = await runReadOnlySql(`',route)+'const rows = await runReadOnlySql(`'.length;
 const end=source.indexOf('`);',start);
 assert.ok(route>=0&&start>route&&end>start,'exact route SELECT owner found');
 const esc=value=>String(value).replaceAll("'","''");
 const queryFor=new Function('serviceDate','assignment','canonicalDeviceId','limit','esc','reminderCredentialId',`return \`${source.slice(start,end)}\`;`);
 const pollQuery=()=>queryFor(week,{assigned_employee_id:row.assigned_employee_id,assignment_epoch:principal.assignment_epoch},code,20,esc,credential)
  .replaceAll('now()',`'${at}'::timestamptz`);
 const poll=async(client=null)=>{
  const c=client??await pool.connect();
  try{
   if(!client)await c.query('begin read only');
   await c.query('set local role custodial_application_reader');
   // Fixed clock only; SELECT and production reader role are actual owners.
   const rows=(await c.query(pollQuery())).rows;
   await c.query('reset role');if(!client)await c.query('commit');return rows;
  }catch(error){if(!client)await c.query('rollback');throw error;}finally{if(!client)c.release();}
 };
 const prepareArgs=job=>[job.job_id,lease,credential,principal.assignment_epoch,registration.registration_id,registration.token_hash,at];
 const prepare=job=>rpc('mz_prepare_employee_native_push_delivery',prepareArgs(job));
 // The exact historical missing grant is reproducible under the real reader.
 const grantProbe=await pool.connect();
 try{await grantProbe.query('begin');await grantProbe.query('revoke execute on function public.mz_location_reminder_candidates(date,timestamptz) from custodial_application_reader');
  await grantProbe.query('set local role custodial_application_reader');
  await assert.rejects(()=>grantProbe.query(pollQuery()),e=>e.code==='42501');
  check('F05 actual reader rejects predecessor missing function grant',true,true);
 }finally{await grantProbe.query('rollback');grantProbe.release();}
 check('actual current reminder candidate exists',Number(await q('select count(*)::int as result from public.mz_location_reminder_candidates($1,$2) where location_id=$3',[week,at,row.location_id])),1);
 check('old projection enqueues once',(await enqueue()).enqueued,1);
 check('same exact projection retry does not duplicate',(await enqueue()).enqueued,0);
 const old=(await jobs())[0],oldData=old.payload_json.data_json;
 check('producer binds actual old projection',[oldData.projection_id,oldData.publication_id],[row.projection_id,row.publication_id]);
 check('old reminder initially validates',(await leased(old)).current,true);
 check('actual HTTP SELECT matches producer projection/key',(await poll()).map(x=>[x.projection_id,x.publication_id,x.notification_key]),[[row.projection_id,row.publication_id,oldData.notification_key]]);
 // An ACK of the old key must not silence the new projection of the same cycle.
  await pool.query("select public.ack_device_notification($1,$2,'location_status','dismissed','{}'::jsonb)",[code,oldData.notification_key]);
  check('dismissal is not fabricated acknowledgement',(await poll()).length,1);
  await pool.query("select public.ack_device_notification($1,$2,'location_status','acknowledged','{}'::jsonb)",[code,oldData.notification_key]);
 check('F08 historical unbound ACK cannot silence current principal',(await poll()).length,1);
 const bound=await pool.connect();
 try{
  await bound.query('begin');
  // Synthetic hostile receipt rows challenge every protected identity field.
  for(const [label,cred,epoch,employee] of [
   ['credential',randomUUID(),principal.assignment_epoch,row.assigned_employee_id],
   ['epoch',credential,Number(principal.assignment_epoch)+1,row.assigned_employee_id],
   ['employee',credential,principal.assignment_epoch,randomUUID()]
  ]){
   await bound.query('savepoint hostile_ack');
   await bound.query(`insert into public.device_notification_acknowledgements(device_identifier,notification_key,notification_type,
    credential_id,assignment_epoch,employee_id,notification_job_id,acknowledged_at)
    values($1,$2,'location_status',$3,$4,$5,$6,statement_timestamp())`,[code,oldData.notification_key,cred,epoch,employee,old.job_id]);
   check('F08 wrong '+label+' ACK does not hide HTTP row',(await poll(bound)).length,1);
   check('F08 wrong '+label+' ACK does not invalidate current job',(await bound.query('select public.mz_validate_employee_location_reminder($1,$2,$3) result',[old.job_id,lease,at])).rows[0].result.current,true);
   await bound.query('select public.mz_enqueue_employee_location_pushes($1)',[at]);
   check('F08 wrong '+label+' ACK does not retire current job',(await bound.query('select status from public.operational_notification_jobs where job_id=$1',[old.job_id])).rows[0].status,'leased');
   await bound.query('rollback to savepoint hostile_ack');
  }
  await bound.query('set local role service_role');
  check('F07 unchanged current job prepares in same SQL transaction',(await bound.query('select public.mz_prepare_employee_native_push_delivery($1,$2,$3,$4,$5,$6,$7) result',prepareArgs(old))).rows[0].result.dispatch_authorized,true);
  const acceptedAck=(await bound.query("select public.ack_native_device_notification($1,$2,$3,$4,$5,$6,'location_status','acknowledged') result",[code,credential,principal.assignment_epoch,row.assigned_employee_id,old.job_id,oldData.notification_key])).rows[0].result;
  check('F08 real ACK returns exact bound identity',[acceptedAck.credential_id,String(acceptedAck.assignment_epoch),acceptedAck.employee_id,acceptedAck.notification_job_id,Boolean(acceptedAck.acknowledged_at)],
   [credential,String(principal.assignment_epoch),row.assigned_employee_id,old.job_id,true]);
  check('F08 real bound ACK hides only exact current HTTP principal',(await poll(bound)).length,0);
  await bound.query('savepoint reader_policy');
  await bound.query('drop policy custodial_reader_bound_notification_ack on public.device_notification_acknowledgements');
  check('F05 predecessor missing RLS policy hides real ACK from reader',(await poll(bound)).length,1);
  await bound.query('rollback to savepoint reader_policy');
  const policyIdentity='public.device_notification_acknowledgements:custodial_reader_bound_notification_ack';
  const policy=(await bound.query("select definition_sql from public.custodial_release_authority_restore_inventory where object_kind='policy' and object_identity=$1",[policyIdentity])).rows;
  check('F05 exact bound ACK policy has recovery inventory',policy.length,1);
  check('F05 exact bound ACK policy recovery definition',policy[0].definition_sql,(await bound.query('select public.custodial_release_authority_current_policy_definition($1) result',[policyIdentity])).rows[0].result);
  await bound.query('drop policy custodial_reader_bound_notification_ack on public.device_notification_acknowledgements');await bound.query(policy[0].definition_sql);
  check('F05 recovered policy exposes only valid ACK to actual reader',(await poll(bound)).length,0);
  await bound.query('set local role service_role');
  check('F07 bound ACK prevents preparation',(await bound.query('select public.mz_prepare_employee_native_push_delivery($1,$2,$3,$4,$5,$6,$7) result',prepareArgs(old))).rows[0].result.dispatch_authorized,false);
 }finally{await bound.query('rollback');bound.release();}
 check('F07 prepublication separate validation is current',(await rpc('mz_validate_employee_location_reminder',[old.job_id,lease,at])).current,true);
 const canaryValues=[['absent',undefined],['null',null],['false',false],['string-true','true'],['one',1],['zero',0],['object',{}],['array',[]],['array-true',[true]],['string-false','false']];
 const withCanary=async(client,value)=>{
  const changed={...old.payload_json,data_json:{...oldData}};
  if(value!==undefined)changed.data_json.test_delivery=value;
  await client.query('update public.operational_notification_jobs set payload_json=$2::jsonb where job_id=$1',[old.job_id,JSON.stringify(changed)]);
 };
 const precheck=await pool.connect();
 try{await precheck.query('begin');
  for(const[label,value]of canaryValues){
   await precheck.query('savepoint precheck');await withCanary(precheck,value);
   assert.notEqual(value,true,'same strict exception as worker prevalidation');
   await precheck.query('set local role service_role');
   check('F07-R1 '+label+' actual P1 prevalidation before P2',(await precheck.query('select public.mz_validate_employee_location_reminder($1,$2,$3) result',[old.job_id,lease,at])).rows[0].result.current,true);
   await precheck.query('rollback to savepoint precheck');
  }
 }finally{await precheck.query('rollback');precheck.release();}
 return async function finish(receipt){
  check('replacement is an actually different projection',receipt.projectionId!==row.projection_id,true);
  check('old leased job cannot validate after actual publication',(await rpc('mz_validate_employee_location_reminder',[old.job_id,lease,at])).current,false);
  check('F07 stale prevalidated job cannot prepare after actual publication',(await prepare(old)).dispatch_authorized,false);
  check('F07 failed stale preparation leaves no receipt',await q('select count(*)::int as result from public.employee_native_push_delivery_receipts where job_id=$1',[old.job_id]),0);
  const canaryProbe=await pool.connect();
  try{await canaryProbe.query('begin');
   const signature='public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)';
   const corrected=(await canaryProbe.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
   const exact="(v_job.payload_json#>'{data_json,test_delivery}') is distinct from 'true'::jsonb";
   const former="coalesce(v_job.payload_json#>>'{data_json,test_delivery}','false')='false'";
   assert.equal(corrected.split(exact).length,2,'one exact correction seam');
   // Reproduce the old predicate in this disposable transaction only, using
   // the SAME real P1/P2 publication and valid registration/lease.
   for(const[label,value]of canaryValues.filter(([label])=>['string-true','one','zero','object','array','array-true'].includes(label))){
    await canaryProbe.query('savepoint predecessor');await canaryProbe.query(corrected.replace(exact,former));await withCanary(canaryProbe,value);
    await canaryProbe.query('set local role service_role');
    check('F07-R1 predecessor really authorizes stale '+label,(await canaryProbe.query('select public.mz_prepare_employee_native_push_delivery($1,$2,$3,$4,$5,$6,$7) result',prepareArgs(old))).rows[0].result.dispatch_authorized,true);
    await canaryProbe.query('reset role');
    check('F07-R1 predecessor really creates stale receipt '+label,Number((await canaryProbe.query('select count(*) count from public.employee_native_push_delivery_receipts where job_id=$1',[old.job_id])).rows[0].count),1);
    await canaryProbe.query('rollback to savepoint predecessor');
   }
   for(const[label,value]of [...canaryValues,['boolean-true',true]]){
    await canaryProbe.query('savepoint corrected');await withCanary(canaryProbe,value);await canaryProbe.query('set local role service_role');
    check('F07-R1 corrected atomic admission '+label,(await canaryProbe.query('select public.mz_prepare_employee_native_push_delivery($1,$2,$3,$4,$5,$6,$7) result',prepareArgs(old))).rows[0].result.dispatch_authorized,value===true);
    await canaryProbe.query('reset role');
    check('F07-R1 corrected receipt count '+label,Number((await canaryProbe.query('select count(*) count from public.employee_native_push_delivery_receipts where job_id=$1',[old.job_id])).rows[0].count),value===true?1:0);
    await canaryProbe.query('rollback to savepoint corrected');
   }
  }finally{await canaryProbe.query('rollback');canaryProbe.release();}
  check('same cycle new projection enqueues despite old ACK',(await enqueue()).enqueued,1);
  const all=await jobs(),fresh=all.find(job=>job.payload_json.data_json.projection_id===receipt.projectionId);
  assert.ok(fresh,'new accepted projection job');
  check('old and new reminders have distinct immutable keys',fresh.job_key!==old.job_key&&fresh.payload_json.data_json.notification_key!==oldData.notification_key,true);
  check('old unsent reminder is retired',all.find(j=>j.job_id===old.job_id).status,'dead');
  check('new reminder bound to exact real accepted pair',[fresh.payload_json.data_json.projection_id,fresh.payload_json.data_json.publication_id],[receipt.projectionId,receipt.publicationId]);
  check('actual HTTP SELECT survives old projection ACK',(await poll()).map(x=>[x.projection_id,x.publication_id,x.notification_key]),[[receipt.projectionId,receipt.publicationId,fresh.payload_json.data_json.notification_key]]);
  check('fresh leased job validates',(await leased(fresh)).current,true);
  check('wrong lease cannot validate',(await rpc('mz_validate_employee_location_reminder',[fresh.job_id,randomUUID(),at])).current,false);
  // Prove preparation actually participates in the publication lock, rather
  // than merely adding a second unlocked read. No provider request is sent.
  const blocker=await pool.connect(),contender=await pool.connect();let pending;
  try{
   await blocker.query('begin');await blocker.query("select pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0))");
   await contender.query('begin');await contender.query('set local role service_role');
   const pid=(await contender.query('select pg_backend_pid() pid')).rows[0].pid;
   pending=contender.query('select public.mz_prepare_employee_native_push_delivery($1,$2,$3,$4,$5,$6,$7) result',prepareArgs(fresh));
   pending.catch(()=>{});
   let waiting=false;
   for(let tries=0;tries<100&&!waiting;tries++){
    waiting=(await blocker.query("select wait_event='advisory' as waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting===true;
    if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
   }
   check('F07 preparation waits on actual common publication lock',waiting,true);
   await blocker.query('rollback');
   check('F07 current job prepares after lock released',(await pending).rows[0].result.dispatch_authorized,true);
  }finally{await blocker.query('rollback');if(pending)await pending;await contender.query('rollback');blocker.release();contender.release();}
  const c=await pool.connect();
  try{
   await c.query('begin');
   for(const [field,value] of [['projection_id',row.projection_id],['publication_id',row.publication_id],['projection_id',null],['notification_key',oldData.notification_key]]){
    await c.query('savepoint hostile_payload');
    const data={...fresh.payload_json.data_json,[field]:value};
    await c.query('update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,\'{data_json}\',$2::jsonb) where job_id=$1',[fresh.job_id,JSON.stringify(data)]);
    await c.query('set local role service_role');
    check('actual validator rejects changed '+field+' '+value,(await c.query('select public.mz_validate_employee_location_reminder($1,$2,$3) as result',[fresh.job_id,lease,at])).rows[0].result.current,false);
    await c.query('rollback to savepoint hostile_payload');
   }
   for(const signature of ['public.mz_enqueue_employee_location_pushes(timestamptz)','public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
    'public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)',
    'public.mz_location_reminder_candidates(date,timestamptz)']){
    for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane']){
     if(role==='custodial_application_reader'&&signature.includes('candidates'))continue;
     await c.query('savepoint denied_caller');await c.query('set local role '+role);
     const args=signature.includes('enqueue')?`'${at}'::timestamptz`:signature.includes('candidates')?`'${week}'::date,'${at}'::timestamptz`:
      signature.includes('prepare')?`'${fresh.job_id}'::uuid,'${lease}'::uuid,'${credential}'::uuid,${principal.assignment_epoch}::bigint,'${registration.registration_id}'::uuid,'${registration.token_hash}'::text,'${at}'::timestamptz`:
       `'${fresh.job_id}'::uuid,'${lease}'::uuid,'${at}'::timestamptz`;
     await assert.rejects(()=>c.query('select '+signature.slice(0,signature.indexOf('('))+'('+args+')'),e=>e.code==='42501');
     check('actual denied caller '+role+' '+signature,true,true);await c.query('rollback to savepoint denied_caller');
    }
    const recovery=(await c.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
    check('exact reminder recovery pair '+signature,recovery.map(x=>x.object_kind),['function','grant']);
    check('exact reminder recovery body '+signature,recovery[0].definition_sql,(await c.query('select pg_get_functiondef($1::regprocedure) as result',[signature])).rows[0].result);
    await c.query('drop function '+signature);for(const item of recovery)await c.query(item.definition_sql);
    check('restored reminder minimum grant '+signature,(await c.query("select has_function_privilege('service_role',$1,'EXECUTE') and not has_function_privilege('anon',$1,'EXECUTE') and not has_function_privilege('authenticated',$1,'EXECUTE') as result",[signature])).rows[0].result,true);
   }
   check('F05 restored exact reader grant works through actual route SELECT',(await poll(c)).length,1);
   for(const signature of ['public.operational_day_start(timestamptz)','public.get_setting_int(text,integer)','public.mz_latest_verified_check(uuid,timestamptz,timestamptz)']){
    const recovery=(await c.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity like '%(%' and to_regprocedure(object_identity)=$1::regprocedure order by restore_order",[signature])).rows;
    check('F05 dependency recovery pair '+signature,recovery.map(x=>x.object_kind),['function','grant']);
    check('F05 dependency recovery body '+signature,recovery[0].definition_sql,(await c.query('select pg_get_functiondef($1::regprocedure) result',[signature])).rows[0].result);
    await c.query('revoke execute on function '+signature+' from custodial_application_reader');
    check('F05 removed dependency grant '+signature,(await c.query("select has_function_privilege('custodial_application_reader',$1,'EXECUTE') result",[signature])).rows[0].result,false);
    for(const item of recovery)await c.query(item.definition_sql);
    check('F05 restored minimum dependency grant '+signature,(await c.query("select has_function_privilege('custodial_application_reader',$1,'EXECUTE') and not has_function_privilege('anon',$1,'EXECUTE') and not has_function_privilege('authenticated',$1,'EXECUTE') result",[signature])).rows[0].result,true);
   }
   check('F05 actual route survives complete dependency recovery',(await poll(c)).length,1);
   await c.query('set local role service_role');
   check('restored validator accepts unchanged current job',(await c.query('select public.mz_validate_employee_location_reminder($1,$2,$3) as result',[fresh.job_id,lease,at])).rows[0].result.current,true);
  }finally{await c.query('rollback');c.release();}
  check('owning proof preserves exact synthetic cleaning session',await q('select count(*)::int as result from public.sessions where id=$1',[session]),1);
  return{status:'PASS',scope:'actual two accepted PostgreSQL projections and real enqueue/validator/HTTP-owner SELECT with fixed synthetic clock; explicit SQL cleaning fixture; no native/physical/provider proof',oldProjectionId:row.projection_id,projectionId:receipt.projectionId,oldJobId:old.job_id,jobId:fresh.job_id};
 };
}
