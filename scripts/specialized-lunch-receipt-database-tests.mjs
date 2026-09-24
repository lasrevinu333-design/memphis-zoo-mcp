import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {nativeNotificationReceiptArguments} from '../src/native-notification-receipt.js';
const container=process.env.LUNCH_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_rebuild_lunch_[0-9]+$/);
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const raw=s=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],
 {input:s,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=s=>raw(s).trim().split('\n').at(-1),json=s=>JSON.parse(sql(s));
const checks=[];
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
const reject=(name,s,pattern)=>{let err;try{raw(s);}catch(e){err=e;}assert.ok(err,name);assert.match(String(err.stderr),pattern,name);checks.push(name);};
const lunch=json("select to_jsonb(d)::text from public.weekly_schedule_lunch_documents d order by accepted_at desc limit 1");
const date=lunch.document_json.loans[0].service_date;
const read=`select public.static_weekly_v8_read_lunch_document(${q(date)}::date)::text;`;
check('real current lunch read',json(read).document_identity,lunch.document_identity);
for(const [name,change] of [
 ['column identity corruption',"document_identity=repeat('0',64)"],
 ['saved semantic body corruption',"document_json=jsonb_set(document_json,'{base_authority_digest}',to_jsonb(repeat('f',64)))"],
 ['saved document digest corruption',"document_json=jsonb_set(document_json,'{document_identity}',to_jsonb(repeat('0',64)))"],
])reject(name,`begin; alter table public.weekly_schedule_lunch_documents disable trigger trg_weekly_schedule_lunch_documents_immutable;
 update public.weekly_schedule_lunch_documents set ${change} where projection_id=${q(lunch.projection_id)};${read}`,/saved lunch document identity mismatch|not bound to the exact verified projection/);
check('failed corruption transactions retain exact real lunch',json(read).document_identity,lunch.document_identity);

const job=json("select to_jsonb(j)::text from public.operational_notification_jobs j where payload_json#>>'{data_json,kind}'='employee_lunch_coverage' and payload_json->>'credential_id' is not null order by created_at limit 1");
const p=job.payload_json,credential=p.credential_id,employee=p.employee_id,epoch=Number(p.assignment_epoch),key=p.data_json.notification_key;
const signature='public.ack_native_device_notification(text,uuid,bigint,uuid,uuid,text,text,text)';
const call=(action,overrides={})=>{
 const b={device:p.device_identifier,credential,epoch,employee,job:job.job_id,key,type:'lunch_coverage',...overrides};
 return `select public.ack_native_device_notification(${q(b.device)},${q(b.credential)}::uuid,${Number(b.epoch)},${q(b.employee)}::uuid,${q(b.job)}::uuid,${q(b.key)},${q(b.type)},${q(action)})::text;`;
};
reject('unsent job cannot prove phone receipt',`set role service_role;${call('received')}`,/no exact authenticated dispatch binding/);
raw(`insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,registration_id,token_hash)
 values(${q(job.job_id)},${q(job.job_key)},${q(job.source_id)},${q(randomUUID())},${q(credential)},${epoch},${q(randomUUID())},repeat('b',64));`);
const received=json(`set role service_role;${call('received')}`);
check('received alone does not invent later actions',[received.displayed_at,received.opened_at,received.dismissed_at,received.acknowledged_at],[null,null,null,null]);
check('received has exact recipient identity',[received.credential_id,received.assignment_epoch,received.employee_id,received.notification_job_id],[credential,epoch,employee,job.job_id]);
check('arrival retry retains first receipt time',json(`set role service_role;${call('received')}`).received_at,received.received_at);
for(const action of ['opened','dismissed','displayed']){
 const row=json(`set role service_role;${call(action)}`);
 check(action+' records only its own evidence',Boolean(row[action+'_at']),true);
 check(action+' does not acknowledge',row.acknowledged_at,null);
 check(action+' retains actual first arrival',row.received_at,received.received_at);
}
const ack=json(`set role service_role;${call('acknowledged')}`);
check('explicit acknowledgment records its own event',Boolean(ack.acknowledged_at),true);
check('acknowledgment is idempotent',json(`set role service_role;${call('acknowledged')}`).acknowledged_at,ack.acknowledged_at);
check('provider preparation never converted to provider acceptance',sql(`select delivery_state from public.employee_native_push_delivery_receipts where job_id=${q(job.job_id)}`),'prepared');
for(const [name,overrides] of [
 ['other notification',{key:key+'-wrong'}],['other job',{job:randomUUID()}],['other device',{device:'KIOSK_OTHER'}],
 ['old assignment',{epoch:epoch+1}],['other employee',{employee:randomUUID()}],['other credential',{credential:randomUUID()}],
 ['wrong kind',{type:'location_status'}],
])reject(name,`set role service_role;${call('received',overrides)}`,/42501/);
reject('revoked credential cannot deliver saved receipt',`begin;update public.device_auth_credentials set revoked_at=now() where credential_id=${q(credential)};set local role service_role;${call('received')}`,/42501/);
reject('assignment changed before replay',`begin;update public.devices set assignment_epoch=assignment_epoch+1 where id=${q(p.device_id)};set local role service_role;${call('received')}`,/42501/);
check('negative tests retain original receipt',json(`set role service_role;${call('received')}`).id,received.id);
if(process.env.CUSTODIAL_NOTIFICATION_CLIENT_MODULE){
 const client=await import(pathToFileURL(process.env.CUSTODIAL_NOTIFICATION_CLIENT_MODULE));
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const principal={device_id:p.device_identifier,credential_id:credential,employee_id:employee,assignment_epoch:epoch};
 const data={...p.data_json,receipt_device_id:p.device_identifier,receipt_credential_id:credential,
  receipt_employee_id:employee,receipt_assignment_epoch:String(epoch),receipt_job_id:job.job_id};
 for(const action of client.NATIVE_NOTIFICATION_LIFECYCLE.produced_actions){
  check('actual client protected producer '+action,await client.persistBoundNativeNotificationReceipt({
   data,action,deviceId:p.device_identifier,getPrincipal:()=>principal,mutate:async f=>f(),storage,prefix:'receipt:'}),true);
  const row=[...memory.values()].map(v=>JSON.parse(v)).find(r=>r.action===action);
  const request=client.nativeNotificationReceiptRequest(row);
  const args=nativeNotificationReceiptArguments({body:request.body,memphisDeviceCredential:{credential_id:credential}},p.device_identifier);
  const actual=json(`set role service_role;select public.ack_native_device_notification(${q(args.p_device_identifier)},${q(args.p_credential_id)}::uuid,${args.p_assignment_epoch},${q(args.p_employee_id)}::uuid,${q(args.p_job_id)}::uuid,${q(args.p_notification_key)},${q(args.p_notification_type)},${q(args.p_action)})::text;`);
  check('actual client/API/SQL chain exact identity '+action,[actual.id,actual.credential_id,actual.employee_id,actual.assignment_epoch],[received.id,credential,employee,epoch]);
  check('actual client/API/SQL idempotent first event '+action,actual[action+'_at'],ack[action+'_at']);
 }
 check('client does not claim unobservable swipe delivery',client.NATIVE_NOTIFICATION_LIFECYCLE.swipe_dismissal,'local_only');
 check('client refuses invented native dismissal',client.createNativeNotificationReceipt({data,action:'dismissed',deviceId:p.device_identifier}),null);
}
for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
 reject(role+' cannot impersonate backend receipt authority',`set role ${role};${call('received')}`,/42501: permission denied for function/);
reject('old unbound lunch route cannot claim native lifecycle',`set role service_role;select public.ack_device_notification(${q(p.device_identifier)},${q(key)},'lunch_coverage','received','{}');`,/exact credential and assignment binding/);
const legacyKey='legacy-local-reminder:'+randomUUID();
for(const action of ['opened','dismissed'])check('legacy '+action+' does not fabricate acknowledgment',json(`set role service_role;select public.ack_device_notification(${q(p.device_identifier)},${q(legacyKey)},'location_status',${q(action)},'{}')::text`).acknowledged_at,null);

const identities=[signature,'public.static_weekly_v8_read_lunch_document(date)','public.ack_device_notification(text,text,text,text,jsonb)'];
for(const identity of identities){
 const norm=sql(`select ${q(identity)}::regprocedure::text`);
 check('exact function recovery '+identity,Number(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity in (${q(identity)},${q(norm)}) and definition_sql=pg_get_functiondef(${q(identity)}::regprocedure)`)),1);
}
raw(`grant execute on function ${signature} to anon;revoke execute on function ${signature} from service_role;`);
const norm=sql(`select ${q(signature)}::regprocedure::text`);
raw(`do $restore$ declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity in (${q(signature)},${q(norm)});execute d;end $restore$;`);
reject('restored exact grant rejects anon',`set role anon;${call('received')}`,/42501: permission denied for function/);
check('restored exact grant admits backend identity',json(`set role service_role;${call('received')}`).id,received.id);
const selectorFunctions=['custodial_dr.guard_release_selection()','custodial_dr.require_single_release_on_resume()'];
const selectorObjects=[...selectorFunctions.map(id=>['function',id]),...selectorFunctions.map(id=>['grant',id]),
 ['column','public.release_deployment_manifest:recovery_staged'],['column_set','public.release_deployment_manifest'],
 ['index','public.release_deployment_manifest_one_ordinary_deployed'],
 ['trigger','public.release_deployment_manifest.trg_release_selection_guard'],
 ['trigger','custodial_dr.restore_control.trg_require_single_release_on_resume']];
for(const [kind,id] of selectorObjects){
 check('one exact recovery object '+id+'/'+kind,Number(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(id)} and definition_sha256=public.static_weekly_digest_text(definition_sql)`)),1);
 if(kind!=='grant')check('required connected health surface '+id,Number(sql(`select count(*) from public.custodial_release_canary_authority_surface() where object_kind=${q(kind)} and object_identity=${q(id)}`)),1);
}
const restore=(kind,id)=>`do $restore$ declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(id)};execute d;end $restore$;`;
const selectorBefore=sql('select coalesce(jsonb_agg(to_jsonb(m) order by release_id),\'[]\') from public.release_deployment_manifest m');
raw('drop index public.release_deployment_manifest_one_ordinary_deployed;'+restore('index','public.release_deployment_manifest_one_ordinary_deployed'));
check('unique release selector restored from sealed inventory',sql("select indisunique from pg_index where indexrelid='public.release_deployment_manifest_one_ordinary_deployed'::regclass"),'t');
for(const id of selectorFunctions){
 raw(`create or replace function ${id} returns trigger language plpgsql security definer set search_path=pg_catalog,custodial_dr as $bad$ begin return new; end $bad$;grant execute on function ${id} to public;`);
 raw(restore('function',id)+restore('grant',id));
 check('exact trigger function restored '+id,sql(`select pg_get_functiondef(${q(id)}::regprocedure)=definition_sql from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(id)}`),'t');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane'])
  check('restored private function denied '+role+'/'+id,sql(`select has_function_privilege(${q(role)},${q(id)},'EXECUTE')`),'f');
}
for(const [kind,id] of selectorObjects.filter(([kind])=>kind==='trigger')){
 const parts=id.split('.'),relation=parts.slice(0,2).join('.'),name=parts[2];
 raw(`alter table ${relation} disable trigger ${name};`+restore(kind,id));
 check('ALWAYS trigger restored '+id,sql(`select tgenabled from pg_trigger where tgrelid=${q(relation)}::regclass and tgname=${q(name)}`),'A');
}
check('release occurrence data unchanged by exact schema recovery',sql('select coalesce(jsonb_agg(to_jsonb(m) order by release_id),\'[]\') from public.release_deployment_manifest m'),selectorBefore);
console.log(JSON.stringify({passed:checks.length,failed:0,checks,fixture:'actual isolated PostgreSQL with synthetic receipts',provider_sent:false,physical_device_tested:false,production:false},null,2));
