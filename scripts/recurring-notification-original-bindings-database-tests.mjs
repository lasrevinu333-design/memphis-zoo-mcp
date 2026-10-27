// Called ONLY by the existing owned network-none migrated-DB harness, inside
// its transaction. Explicit synthetic native-generation DATA below is not a
// native HTTP/attestation/Current/profile/audio fact. Actual normal job producer,
// original reservation/dispatch-attempt SQL and binding selector are exercised.
import assert from 'node:assert/strict';
import {EXPECTED_NOTIFICATION_PLAN_SOURCE_RELATIONS} from './recurring-notification-incumbency-closure-tests.mjs';
import {randomUUID,createHash}from'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fields=['notification_key','receipt_job_id','generation_id','registration_id','principal_digest','token_digest',
 'reservation_at','valid_until','content_sha256','native_kind','audio_origin','speech_sha256'];
export async function testOriginalNativePlanBindings({client:c,fixture:f,check}){
 await c.query('savepoint original_native_binding_cases');
 try{
  const privateRpc='public.static_weekly_v27_original_native_bindings(jsonb,timestamp with time zone)';
  for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
   check((await c.query("select has_function_privilege($1,$2,'EXECUTE') value",[role,privateRpc])).rows[0].value,false,'private original binding RPC denied '+role);
  const sources=(await c.query(`select n.nspname||'.'||c.relname name,g.tgtype,g.tgenabled from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where g.tgname='custodial_recurring_notification_plan_source_fence' order by n.nspname,c.relname`)).rows;
  check(sources.map(x=>x.name),EXPECTED_NOTIFICATION_PLAN_SOURCE_RELATIONS,'exact sorted53 schema-qualified complete-plan and original-job source fences');check(sources.every(x=>x.tgenabled==='A'&&x.tgtype===62),true,'all53 ALWAYS statement INSERT UPDATE DELETE TRUNCATE');
  const document=(await c.query('select document_json value from public.weekly_schedule_lunch_documents where projection_id=$1',[f.projectionId])).rows[0].value;
  const intent=document.notification_intents.find(n=>n.service_date===f.serviceDate&&n.event==='start'&&document.responsibilities.some(r=>r.loan_id===n.loan_id&&r.coverer_slot_id===n.coverer_slot_id&&r.coverer_person_id===f.employee));
  assert.ok(intent,'same actual accepted lunch document must contain this recipient start');
  // PRIVATE owner-only synthetic SQL-business observation time, never a real
  // public current GET/receipt or physical UTC qualification. No clock function
  // replacement or mutable issued row. The actual public phase remains separate.
  const at=(await c.query("select public.custodial_native_location_utc((($1::date+$2::time) at time zone 'America/Chicago')+interval '1 second') value",[f.serviceDate,intent.scheduled_time])).rows[0].value;
  await c.query("insert into public.system_settings(setting_key,setting_value)values('off_shift_employee_notifications_override_enabled','true') on conflict(setting_key)do update set setting_value=excluded.setting_value");
  const planAt=async()=>{await c.query('select public.static_weekly_v27_lock_notification_plan_sources()');return(await c.query('select public.static_weekly_v27_notification_plan_at($1,$2,$3,$4,$5,$6,$7,$8) value',[f.serviceDate,f.device,f.credential,f.employee,f.epoch,f.intent,f.delivery.targetDigest,at])).rows[0].value;};
  const first=await planAt();assert.ok(first.body.required_effects.length>0,'actual full normal derivation must really be NONEMPTY');
  assert.ok(first.body.required_effects.every(x=>x.origin==='FULL_ACCEPTED_LUNCH_DOCUMENT'),'this SQL fixture owns lunch reservation coverage; location predicate remains separately scoped');
  check([first.schema,first.body.schema],['custodial.recurring-current-notification-plan-envelope.v2','custodial.recurring-current-notification-plan.v2'],'nonempty actual full plan explicitly uses v2');
  check(first.body.delivery_bindings,{schema:'custodial.recurring-original-native-delivery-bindings.v1',state:'UNAVAILABLE',entries:[]},'missing original reservation is unavailable, never empty proof');
  const effects=JSON.stringify(first.body.required_effects),audio=JSON.stringify(first.body.required_audio),target=JSON.stringify(f.delivery.target);
  const token='SYNTHETIC-ORIGINAL-BINDING-NOT-FCM-'+randomUUID(),tokenDigest=hash(token),generation=randomUUID(),principalDigest=hash('synthetic-native-generation-DATA-'+randomUUID());
  check(Number((await c.query('select count(*) n from public.employee_native_push_generations where device_id=$1',[f.device])).rows[0].n),0,'do not adopt, delete or overwrite any existing native history');
  await c.query("select public.mz_register_employee_push($1,$2,$3,'android','synthetic-only','synthetic.custodial.df36d32368b6')",[f.credential,token,tokenDigest]);
  const registrations=(await c.query('select registration_id from public.employee_push_registrations where device_id=$1 and credential_id=$2 and employee_id=$3 and assignment_epoch=$4 and active',[f.device,f.credential,f.employee,f.epoch])).rows;
  assert.equal(registrations.length,1);const registration=registrations[0].registration_id;
  const app={package_name:'org.memphiszoo.custodial',version_name:'synthetic-only',version_code:53,build_id:'synthetic.custodial.df36d32368b6'};
  // Explicit SQL DATA fixture seam only, using every real mandatory constraint;
  // no trigger/FK/RLS disable, native request, protected Java owner or SDK grant.
  await c.query(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,
   credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,request_fingerprint,first_native_request_id,first_attestation_digest,activated_at)
   values($1,$2,$3,$4,'KIOSK_08',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz-interval '1 minute')`,
   [generation,randomUUID(),registration,f.device,f.credential,f.employee,f.epoch,principalDigest,tokenDigest,app,hash('synthetic request'),randomUUID(),hash('synthetic attestation'),at]);
  await c.query('select public.mz_enqueue_employee_lunch_coverage_pushes($1)',[at]);
  for(const effect of first.body.required_effects){
   const rows=(await c.query("select job_id from public.operational_notification_jobs where job_key=$1 and job_type='employee_native_push'",['employee-lunch-push:'+effect.notification_key+':'+f.credential])).rows;
   assert.equal(rows.length,1,'actual normal producer creates ONE original job, not an intent-derived fake ID');const job=rows[0].job_id,lease=randomUUID();
   check((await c.query("update public.operational_notification_jobs set status='leased',leased_at=$2,leased_until=$2::timestamptz+interval '2 minutes',lease_token=$3 where job_id=$1",[job,at,lease])).rowCount,1,'lease only actual owned synthetic job');
   const originalTarget=(await c.query('select public.custodial_native_lunch_target_at($1,$2,$3) value',[job,lease,at])).rows[0].value;
   assert.equal(originalTarget.current,true,'actual target predicate requires same accepted loan/principal/generation');
   await c.query('savepoint historical_null_reservation');
   try{
    await c.query(`insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,registration_id,token_hash,prepared_at)
     select job_id,job_key,source_id,$2,$3,$4,$5,$6,$7 from public.operational_notification_jobs where job_id=$1`,[job,lease,f.credential,f.epoch,registration,tokenDigest,at]);
    check((await planAt()).body.delivery_bindings.state,'UNAVAILABLE','historical native-null reservation cannot acquire original native lineage');
    check((await c.query('select native_generation_id from public.employee_native_push_delivery_receipts where job_id=$1',[job])).rows[0].native_generation_id,null,'unknown original remains unchanged');
   }finally{await c.query('rollback to savepoint historical_null_reservation');await c.query('release savepoint historical_null_reservation');}
   const prepared=(await c.query('select public.custodial_native_lunch_dispatch_prepare_at($1,$2,$3,$4) value',[job,lease,originalTarget.expected,at])).rows[0].value;
   assert.equal(prepared.dispatch_authorized,true,'actual SQL reserves once and retains original dispatch attempt; no FCM call');
   const noReplay=(await c.query('select public.custodial_native_lunch_dispatch_prepare_at($1,$2,$3,$4) value',[job,lease,originalTarget.expected,at])).rows[0].value;
   check(noReplay.dispatch_authorized,false,'original reservation unknown/replay never authorizes a second send');
  }
  const ready=await planAt();check(ready.body.delivery_bindings.state,'ORIGINAL_NATIVE_RESERVATIONS','complete original reservation DATA selected');
  check(ready.body.delivery_bindings.entries.map(x=>x.notification_key),ready.body.required_effects.map(x=>x.notification_key),'complete distinct key bindings in canonical DATA order, not SDK chronology');
  check([JSON.stringify(ready.body.required_effects),JSON.stringify(ready.body.required_audio),JSON.stringify(f.delivery.target)],[effects,audio,target],'normal effects/audio obligations/target unchanged by original metadata selection');
  for(const entry of ready.body.delivery_bindings.entries){
   check(Object.keys(entry).sort(),[...fields].sort(),'minimal exact12 nonsecret string fields');assert.ok(Object.values(entry).every(x=>typeof x==='string'));
   const original=(await c.query('select native_payload,native_payload_sha256,registration_id from public.employee_native_push_delivery_receipts where job_id=$1',[entry.receipt_job_id])).rows[0];
   check([entry.content_sha256,entry.speech_sha256,entry.registration_id,entry.native_kind,entry.audio_origin],[original.native_payload_sha256,hash(original.native_payload.body),original.registration_id,'employee_lunch_coverage','ORIGINAL_NATIVE_JOB'],'actual immutable native body/content/registration, not normal-word guess');
  }
  const bind=async(body,time=at)=>(await c.query('select public.static_weekly_v27_original_native_bindings($1,$2) value',[body,time])).rows[0].value;
  const wrong=structuredClone(ready.body);wrong.required_effects[0].notification.data.loan_id=randomUUID();check((await bind(wrong)).state,'UNAVAILABLE','same key cannot borrow different accepted loan semantics');
  const duplicate=structuredClone(ready.body);duplicate.required_effects.push(structuredClone(duplicate.required_effects[0]));check((await bind(duplicate)).state,'UNAVAILABLE','duplicate obligation cannot duplicate one original job');
  const expired=(await c.query("select public.custodial_native_location_utc(max(native_valid_until)) value from public.employee_native_push_delivery_receipts where credential_id=$1",[f.credential])).rows[0].value;
  check((await bind(ready.body,expired)).state,'UNAVAILABLE','original native expiry refuses exact boundary');
  await c.query('savepoint retired_original_generation');try{
   await c.query('update public.employee_native_push_generations set dispatch_retired_at=$2,revoked_at=$2 where generation_id=$1',[generation,at]);
   check((await bind(ready.body)).state,'UNAVAILABLE','revoked original generation cannot be adopted from matching metadata');
  }finally{await c.query('rollback to savepoint retired_original_generation');await c.query('release savepoint retired_original_generation');}
  return{scope:'actual SQL original-reservation metadata DATA; synthetic generation/time; no native/physical/HTTP positive',requiredKeys:ready.body.required_effects.length};
 }finally{await c.query('rollback to savepoint original_native_binding_cases');await c.query('release savepoint original_native_binding_cases');}
}
// Separate connections and transactions, invoked after the case transaction
// settles. Even zero-row writes take the actual BEFORE STATEMENT source fence.
export async function testOriginalNativeSourceConflicts({writer,reader,check}){
 const cases=[['operational_notification_jobs','status'],['employee_native_push_delivery_receipts','delivery_state'],
  ['employee_native_push_generations','dispatch_retired_at'],['employee_push_registrations','last_seen_at'],['employee_native_lunch_dispatch_attempts','attempt_id']];
 for(const[table,column]of cases){
  await writer.query('begin');await reader.query('begin');try{
   await writer.query("set local statement_timeout='3000ms'");await reader.query("set local statement_timeout='3000ms'");
   await writer.query(`update public.${table} set ${column}=${column} where false`);
   let error;try{await reader.query('select public.static_weekly_v27_lock_notification_plan_sources()');}catch(failure){error=failure;}
   assert.ok(error,'actual new source writer must refuse reader');check(error.code,'40001','pre-existing original source writer refuses without waiting '+table);
  }finally{await reader.query('rollback');await writer.query('rollback');}
 }
}
