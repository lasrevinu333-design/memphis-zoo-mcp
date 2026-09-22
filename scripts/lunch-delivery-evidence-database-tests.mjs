import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// Synthetic receipt-state fixtures only; no real provider/device evidence.
const container=process.env.LUNCH_DELIVERY_TEST_CONTAINER;
assert.match(container??'',/^mz_verified_visit_[0-9]+$/,'owned disposable database required');
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${q(JSON.stringify(value))}::jsonb`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At',
 '-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input:text,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim().split('\n').at(-1);}
const manager=randomUUID(),credential=randomUUID(),suffix=randomUUID();
sql(`insert into public.ops_manager_managers(manager_id,display_name)
 values(${q(manager)},'Synthetic delivery manager');
 insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,
 max_access_level,manager_id,expires_at) values(${q(credential)},${q(suffix)},'Synthetic delivery device',
 ${q('a'.repeat(64))},'full_access',${q(manager)},now()+interval '1 day');
 insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
 values(${q(credential)},${q(manager)},${q(suffix)},'android',${q('synthetic-fcm-'+suffix)});`);
let passed=0;const failures=[];
function test(name,fn){try{fn();passed++;}catch(error){failures.push({name,error:error.message});}}
function makeJob(state=null,options={}){
 const id=randomUUID(),source=randomUUID(),recipient=randomUUID(),lease=randomUUID();
 const key='synthetic-lunch-job:'+id;
 const data={kind:'employee_lunch_coverage',notification_type:'lunch_coverage',event:'start',
  notification_key:'synthetic-lunch:'+id,loan_id:randomUUID(),...options.data};
 const payload={credential_id:recipient,assignment_epoch:1,device_identifier:'SYNTHETIC_PHONE',
  employee_id:randomUUID(),data_json:data};
 sql(`insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,
 lease_token,leased_until,payload_json,last_error) values(${q(id)},${q(key)},'employee_native_push',
 ${q(source)},${q(options.status??'dead')},${q(lease)},now()+interval '1 minute',${json(payload)},
 'RAW_PROVIDER_TOKEN_MUST_NOT_LEAK');`);
 if(state)sql(`insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,
 lease_token,credential_id,assignment_epoch,registration_id,token_hash,delivery_state,
 provider_message_id,delivered_at) values(${q(id)},${q(key)},${q(source)},${q(lease)},
 ${q(options.mismatched?randomUUID():recipient)},1,${q(randomUUID())},${q('b'.repeat(64))},${q(state)},
 ${state==='delivered'?q('synthetic-provider-acceptance'):'null'},${state==='delivered'?'now()':'null'});`);
 return {id,lease,payload};
}
const enqueue=job=>JSON.parse(sql(`select public.ops_manager_enqueue_lunch_delivery_failure(${q(job.id)})::text`));
const row=job=>JSON.parse(sql(`select row_to_json(item)::text from public.ops_manager_notification_queue item
 where source_id=${q(job.id)} and credential_id=${q(credential)}`));
const count=job=>Number(sql(`select count(*) from public.ops_manager_notification_queue
 where source_id=${q(job.id)} and credential_id=${q(credential)}`));
const unknown=makeJob('prepared');enqueue(unknown);const unknownRow=row(unknown);
test('uncertain dispatch is not a confirmed failure',()=>assert.equal(unknownRow.data_json.terminal_delivery_failure,false));
test('uncertain title does not assert failure',()=>assert.doesNotMatch(unknownRow.title,/failed/i));
test('uncertain body describes uncertainty',()=>assert.match(unknownRow.body,/could not be confirmed/i));
test('uncertain provider evidence retained',()=>assert.equal(unknownRow.data_json.delivery_evidence,'provider_outcome_unknown'));
const accepted=makeJob('delivered');enqueue(accepted);const acceptedRow=row(accepted);
test('accepted send is not labeled failed',()=>assert.equal(acceptedRow.data_json.terminal_delivery_failure,false));
test('accepted provider result distinguished',()=>assert.equal(acceptedRow.data_json.delivery_evidence,'provider_accepted'));
test('accepted send does not claim phone receipt',()=>assert.equal(acceptedRow.data_json.device_receipt_status,'not_evaluated'));
const rejected=makeJob();enqueue(rejected);const rejectedRow=row(rejected);
test('actual pre-dispatch/rejected failure preserved',()=>assert.equal(rejectedRow.data_json.terminal_delivery_failure,true));
test('actual failure remains actionable',()=>assert.match(rejectedRow.title,/failed/i));
test('no raw provider detail disclosed',()=>assert.ok(!JSON.stringify(rejectedRow).includes('RAW_PROVIDER_TOKEN_MUST_NOT_LEAK')));
for(const job of [unknown,accepted,rejected])test('replay deduplicates '+job.id,()=>{enqueue(job);assert.equal(count(job),1);});
const mismatch=makeJob('delivered',{mismatched:true});enqueue(mismatch);
test('mismatched receipt cannot prove acceptance',()=>assert.equal(row(mismatch).data_json.delivery_evidence,'receipt_binding_unverified'));
test('mismatched receipt cannot prove non-delivery',()=>assert.equal(row(mismatch).data_json.terminal_delivery_failure,false));
for(const options of [{status:'pending'},{data:{kind:'employee_message'}},{data:{kind:null}},{data:{notification_type:null}}]){
 const job=makeJob(null,options);enqueue(job);test('unrelated/nonterminal job ignored '+job.id,()=>assert.equal(count(job),0));
}
const terminal=makeJob('prepared',{status:'leased'});
sql(`select public.finish_operational_notification_job_terminal(${q(terminal.id)},${q(terminal.lease)},'RAW_PROVIDER_TOKEN_MUST_NOT_LEAK');`);
test('terminalization still alerts atomically',()=>assert.equal(count(terminal),1));
test('unknown terminal state remains truthful',()=>assert.equal(row(terminal).data_json.terminal_delivery_failure,false));
const expired=makeJob();
sql(`update public.ops_manager_trusted_devices set expires_at=now()-interval '1 second' where credential_id=${q(credential)};`);
enqueue(expired);test('expired manager credential excluded',()=>assert.equal(count(expired),0));
test('public cannot invoke alert authority',()=>assert.equal(sql(`select (not has_function_privilege('anon',
 'public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)','EXECUTE') and not has_function_privilege('authenticated',
 'public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)','EXECUTE'))::text`),'true'));
console.log(JSON.stringify({passed,failed:failures.length,failures,fixture:'isolated synthetic receipts',
 provider_sent:false,device_receipt_verified:false},null,2));
if(failures.length)process.exitCode=1;
