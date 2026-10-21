import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {loadMessageDispatcher} from './employee-message-source-admission-tests.mjs';

// Synthetic source state, not a client-authorized deletion operation. Preserve
// the existing 20260718184652 deletion-state CHECK; do not disable a constraint
// merely to reach the admission refusal under test.
export function messageDeletedSourceMutation(messageId){
 assert.match(messageId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 return `update public.msg_messages set is_deleted=true,deleted_at=now(),purge_after=now()+interval '14 days' where id='${messageId}'`;
}

// Additive fixture export only. Importing this file launches nothing. An owning
// exact-source/no-auto-grants/network-none runner must supply its verified SQL
// capability after replay. This module is not that runner or global recovery.
export async function verifyEmployeeMessageSourceAdmissionDatabase({sql,target}) {
 assert.equal(typeof sql,'function');
 assert.equal(target?.network,'none');assert.equal(target?.synthetic,true);
 assert.match(target?.id||'',/^[0-9a-f]{64}$/);
 const q=x=>`'${String(x).replaceAll("'","''")}'`;
 const id=n=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 let checks=0;
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;};
 const json=async statement=>JSON.parse(String(await sql(statement)).trim());
 const employee=id(1),device=id(2),credential=id(3),recipient=id(4),sender=id(5),thread=id(6),message=id(7);
 const token='synthetic-message-source-only-token',tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 const prepare='public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)';
 check('named synthetic target initially absent',String(await sql(`select count(*) from public.employees where id=${q(employee)};`)).trim(),'0');
 await sql(`insert into public.employees(id,employee_code,display_name,role,active)
  values(${q(employee)},'EMP993','Synthetic MESSAGE recipient','staff',true);
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
  values(${q(device)},'KIOSK_08','Synthetic MESSAGE phone',true,${q(employee)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
  values(${q(credential)},${q(device)},repeat('c',64),now()-interval '1 day',now()+interval '1 day');
  set role service_role;select public.mz_register_employee_push(${q(credential)},${q(token)},${q(tokenHash)},'android','synthetic-only','synthetic.message-source');`);
 await sql(`insert into public.msg_users(id,employee_id,display_name,role,is_active)
  values(${q(recipient)},${q(employee)},'Synthetic MESSAGE recipient','employee',true),
   (${q(sender)},null,'Synthetic sender','employee',true);
  insert into public.msg_threads(id,thread_type,created_by_user_id,is_active)
  values(${q(thread)},'direct',${q(sender)},true);
  insert into public.msg_thread_participants(thread_id,user_id) values(${q(thread)},${q(recipient)}),(${q(thread)},${q(sender)});
  insert into public.msg_messages(id,thread_id,sender_user_id,body,sent_at,created_at)
  values(${q(message)},${q(thread)},${q(sender)},'Original synthetic MESSAGE body',now()-interval '2 seconds',now()-interval '2 seconds');
  insert into public.msg_receipts(message_id,user_id) values(${q(message)},${q(recipient)}) on conflict(message_id,user_id) do nothing;`);
 const key=`employee-message-push:${message}:${credential}`;
 const claimed=await json(`set role service_role;select to_jsonb(j)::text from public.claim_operational_notification_job_by_key(${q(key)},'synthetic-message-source-fixture',120) j;`);
 assert.equal(claimed.job_key,key);check('actual producer/claim source',claimed.source_id,message);
 const registration=await json(`select to_jsonb(r)::text from public.employee_push_registrations r where credential_id=${q(credential)} and active;`);
 const args=[claimed.job_id,claimed.lease_token,credential,1,registration.registration_id,tokenHash];
 const call=(values=args)=>`public.mz_prepare_employee_native_push_delivery(${values.map(q).join(',')},now())`;
 const snapshot=`select jsonb_build_object(
  'employee',(select to_jsonb(e) from public.employees e where id=${q(employee)}),
  'device',(select to_jsonb(d) from public.devices d where id=${q(device)}),
  'credential',(select to_jsonb(c) from public.device_auth_credentials c where credential_id=${q(credential)}),
  'registration',(select to_jsonb(r) from public.employee_push_registrations r where registration_id=${q(registration.registration_id)}),
  'thread',(select to_jsonb(t) from public.msg_threads t where id=${q(thread)}),
  'users',(select jsonb_agg(to_jsonb(u) order by id) from public.msg_users u where id in(${q(recipient)},${q(sender)})),
  'participants',(select jsonb_agg(to_jsonb(p) order by id) from public.msg_thread_participants p where thread_id=${q(thread)}),
  'deletions',(select jsonb_agg(to_jsonb(d) order by id) from public.msg_message_deletions d where message_id=${q(message)}),
  'visibility',(select jsonb_agg(to_jsonb(v) order by id) from public.msg_thread_visibility v where thread_id=${q(thread)}),
  'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.msg_messages m where id=${q(message)}),
  'receipts',(select jsonb_agg(to_jsonb(r) order by user_id) from public.msg_receipts r where message_id=${q(message)}),
  'job',(select to_jsonb(j) from public.operational_notification_jobs j where job_id=${q(claimed.job_id)}),
  'delivery',(select to_jsonb(d) from public.employee_native_push_delivery_receipts d where job_id=${q(claimed.job_id)}))::text`;
 const before=await sql(snapshot);
 async function refused(name,mutation,values=args){
  const row=await json(`begin;${mutation};set local role service_role;select ${call(values)}::text;rollback;`);
  check(name+' refused',row.current,false);check(name+' no dispatch',row.dispatch_authorized,false);
  check(name+' protected/queued bytes after rollback',await sql(snapshot),before);
 }
 for(const [name,mutation] of [
  ['deleted',messageDeletedSourceMutation(message)],
  ['inactive thread',`update public.msg_threads set is_active=false where id=${q(thread)}`],
  ['departed membership',`update public.msg_thread_participants set left_at=now() where thread_id=${q(thread)} and user_id=${q(recipient)}`],
  ['inactive recipient',`update public.msg_users set is_active=false where id=${q(recipient)}`],
  ['inactive employee',`update public.employees set active=false where id=${q(employee)}`],
  ['ACK',`update public.msg_receipts set acknowledged_at=now() where message_id=${q(message)} and user_id=${q(recipient)}`],
  ['receipt missing',`delete from public.msg_receipts where message_id=${q(message)} and user_id=${q(recipient)}`],
  ['per-user deletion',`insert into public.msg_message_deletions(message_id,user_id) values(${q(message)},${q(recipient)})`],
  ['hidden',`insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before) values(${q(thread)},${q(recipient)},null,now())`],
  ['content changed',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{body}','"forged"') where job_id=${q(claimed.job_id)}`],
  ['thread crossed',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,thread_id}',to_jsonb(${q(id(99))}::text)) where job_id=${q(claimed.job_id)}`],
  ['source key crossed',`update public.operational_notification_jobs set job_key='crossed' where job_id=${q(claimed.job_id)}`],
  ['kind omitted cannot bypass',`update public.operational_notification_jobs set payload_json=payload_json#-'{data_json,kind}' where job_id=${q(claimed.job_id)}`],
  ['registration revoked',`update public.employee_push_registrations set active=false,revoked_at=now() where registration_id=${q(registration.registration_id)}`],
  ['expired original lease',`update public.operational_notification_jobs set leased_until=now()-interval '1 second' where job_id=${q(claimed.job_id)}`],
 ])await refused(name,mutation);
 for(const [index,name] of [[1,'lease'],[2,'credential'],[3,'epoch'],[4,'registration'],[5,'token']]){
  const changed=[...args];changed[index]=index===3?2:index===5?'d'.repeat(64):id(90);
  await refused('crossed '+name,'select 1 where false',changed);
 }
 const readOnly=await json(`begin;update public.msg_receipts set read_at=now() where message_id=${q(message)} and user_id=${q(recipient)};
  set local role service_role;select ${call()}::text;rollback;`);
 check('read is not ACK',readOnly.dispatch_authorized,true);
 check('actual SQL projection exact original bytes',readOnly.message_projection.payload,claimed.payload_json);
 check('actual SQL occurrence',readOnly.message_projection.job_id,claimed.job_id);
 check('actual SQL lease',readOnly.message_projection.lease_token,claimed.lease_token);
 check('actual SQL original recipient',readOnly.message_projection.recipient_user_id,recipient);
 check('actual SQL token generation',readOnly.message_projection.token_hash,tokenHash);
 assert.match(readOnly.message_projection.source_revision,/^[0-9a-f]{64}$/);checks++;
 check('read control preserved bytes',await sql(snapshot),before);
 const original=await json(`begin;set local role service_role;do $prepare$ begin perform ${call()};end $prepare$;
  reset role;update public.msg_receipts set acknowledged_at=now() where message_id=${q(message)} and user_id=${q(recipient)};
  set local role service_role;select ${call()}::text;rollback;`);
 check('already prepared original returned before later ACK',original.already_prepared,true);
 check('ambiguous original cannot authorize retry',original.dispatch_authorized,false);
 check('ambiguous original remains uncertain',original.delivery_outcome_unknown,true);
 check('original control preserved bytes',await sql(snapshot),before);
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  let error;try{await sql(`set role ${role};select ${call()};`);}catch(e){error=e;}
  assert.ok(error,'existing service prepare must deny '+role);assert.match(String(error.stderr||error.message),/permission denied/);checks++;
 }
 check('no PUBLIC prepare privilege',String(await sql(`select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid=${q(prepare)}::regprocedure and a.grantee=0;`)).trim(),'0');
 check('prepare keeps intended service role',String(await sql(`select has_function_privilege('service_role',${q(prepare)},'execute');`)).trim(),'t');
 for(const fn of [prepare])for(const kind of ['function','grant']){
  check('exact captured '+kind+' '+fn,String(await sql(`select count(*)>0 and bool_and(i.definition_sha256=public.static_weekly_digest_text(i.definition_sql)
   and i.definition_sql=${kind==='function'?`pg_get_functiondef(${q(fn)}::regprocedure)`:'public.custodial_release_authority_current_grant_definition(i.object_identity)'})
   from public.custodial_release_authority_restore_inventory i where i.object_kind=${q(kind)}
    and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=${q(fn)}::regprocedure;`)).trim(),'t');
 }
 check('existing prepare remains required surface member',String(await sql(`select count(*) from public.custodial_release_canary_authority_surface() where object_kind='function'
  and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end=${q(prepare)}::regprocedure;`)).trim(),'1');
 const install=await loadMessageDispatcher();let sends=0;
 const allowed=new Set(['mz_get_employee_native_push_delivery_receipt','mz_resolve_employee_push_delivery','mz_prepare_employee_native_push_delivery','mz_record_employee_native_push_delivery']);
 const runtime=install({use(){},get(){},post(){},delete(){}},{supabase:{async rpc(name,params){
  assert.ok(allowed.has(name),'finite fixture RPC only');
  return {data:await json(`set role service_role;select public.${name}(${Object.entries(params).map(([k,v])=>`${k}=>${q(v)}`).join(',')})::text;`)};
 }},pushRuntime:{configured:true,async send(push){
  check('actual SQL original body reaches real JS consumer',push.body,claimed.payload_json.body);
  check('actual SQL original route reaches real JS consumer',push.data_json.route,claimed.payload_json.data_json.route);
  sends++;return 'synthetic-message-provider-response';
 }}});
 await runtime.deliverClaimedJob(claimed);check('exact one synthetic provider call',sends,1);
 await sql(`set role service_role;select public.msg_acknowledge_message(${q(message)},${q(recipient)},'KIOSK_08');`);
 const replay=await runtime.deliverClaimedJob(claimed);check('original delivered result survives later ACK',replay.replayed,true);
 check('no resend after exact recorded outcome',sends,1);
 const protectedAfter=await sql(snapshot);
 // Scoped rollback repair from the original captured prepare body/ACL. No
 // surviving catalog is adopted as required authority or global recovery.
 await sql(`begin;do $probe$ declare body text;acl text;begin
  select definition_sql into strict body from public.custodial_release_authority_restore_inventory where object_kind='function'
   and to_regprocedure(object_identity)=${q(prepare)}::regprocedure;
  select definition_sql into strict acl from public.custodial_release_authority_restore_inventory where object_kind='grant'
   and to_regprocedure(object_identity)=${q(prepare)}::regprocedure;
  execute replace(body,'message_lease_or_credential_expired','synthetic_fault');
  if pg_get_functiondef(${q(prepare)}::regprocedure)=body then raise exception 'body fault not established';end if;
  execute body;if pg_get_functiondef(${q(prepare)}::regprocedure)<>body then raise exception 'body repair failed';end if;
  execute 'grant execute on function ${prepare} to anon';
  if not has_function_privilege('anon',${q(prepare)},'execute') then raise exception 'ACL fault not established';end if;
  execute acl;if has_function_privilege('anon',${q(prepare)},'execute') then raise exception 'ACL repair failed';end if;
  if not has_function_privilege('service_role',${q(prepare)},'execute') then raise exception 'intended ACL lost';end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory i where i.object_kind='grant'
    and case when position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity) end=${q(prepare)}::regprocedure
    and i.definition_sql is distinct from public.custodial_release_authority_current_grant_definition(i.object_identity)) then
    raise exception 'exact original grant readback differs';end if;
 end $probe$;rollback;`);checks+=4;
 check('scoped repair preserved protected original work',await sql(snapshot),protectedAfter);
 return {status:'PASS',checks,scope:'synthetic actual MESSAGE producer/lease/current-source prepare and JS dispatcher; scoped existing prepare recovery only',
  target:{id:target.id,network:'none'},production:false,provider_delivery:false,
  limitations:['No new native MESSAGE kind or effect policy','No full global controller restore','Owning replay/cleanup receipt required separately']};
}
