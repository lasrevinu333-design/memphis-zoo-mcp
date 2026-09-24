import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const container=process.env.SHIFT_END_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input:'set statement_timeout=30000;'+text,encoding:'utf8',timeout:35000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']}).trim().split('\n').at(-1);
const json=text=>JSON.parse(sql(text));let checks=0;
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
const reject=(name,query,pattern)=>{
 let message='';try{sql(query);}catch(e){message=String(e.stderr||e.message);}
 assert.match(message,pattern??/ERROR/,name);checks++;console.log('PASS',name);
};
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager=id(1),browser=id(2),station=id(3),other=id(4),device=id(5),employee=id(6),healthy=id(7),lineage=id(8);
const workstation='CUSTODIAL-MAINTENANCE-11000000-0000-4000-8000-000000000003';
const envelope={version:'assigned-activation.aes-256-gcm.v1',ciphertext:'c'.repeat(58),iv:'i'.repeat(16),tag:'t'.repeat(22)};
const service=(fn,args)=>`set role service_role;select public.${fn}(${args})::text;`;
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values(${q(manager)},'Synthetic Activation Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at)
 values(${q(browser)},'synthetic-browser','Browser',repeat('a',64),'full_access',${q(manager)},now()+interval '1 day'),
 (${q(station)},${q(workstation)},'Maintenance',repeat('b',64),'full_access',${q(manager)},now()+interval '1 day'),
 (${q(other)},'CUSTODIAL-MAINTENANCE-11000000-0000-4000-8000-000000000004','Other workstation',repeat('d',64),'full_access',${q(manager)},now()+interval '1 day');
 insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMP996','Synthetic Activation Custodian','staff',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
 values(${q(device)},'KIOSK_08','Synthetic only KIOSK_08',true,${q(employee)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,created_at)
 values(${q(healthy)},${q(device)},repeat('e',64),'Synthetic healthy phone',now()-interval '1 day',now()+interval '1 day',now()-interval '1 day');
 insert into public.device_auth_enrollment_operations(operation_id,device_id,credential_id,flow,request_fingerprint,status,resume_expires_at,confirmed_at)
 values(${q(lineage)},${q(device)},${q(healthy)},'enrollment',repeat('f',64),'confirmed',now()-interval '1 day',now()-interval '1 day');`);
const epoch=()=>Number(sql(`select assignment_epoch from public.devices where id=${q(device)};`));
const request=(op,ep=epoch())=>service('custodial_activation_request',`${q(op)},'KIOSK_08',${q(employee)},${ep},${q(manager)},${q(browser)},repeat('a',64)`);
const claim=(op,cred=station,serial='a'.repeat(64),enc=envelope)=>service('custodial_activation_claim',
 `${q(op)},${q(manager)},${q(cred)},${q(workstation)},${q(serial)},'custodial-maintenance-v1',repeat('c',64),${j(enc)}`);
const countCodes=()=>Number(sql('select count(*) from public.device_auth_enrollment_codes;'));
for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
 reject('private table denied '+role,`set role ${role};select * from public.custodial_assigned_activation_operations;`,/permission denied/);
for(const role of ['anon','authenticated','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
 reject('request RPC denied '+role,request(id(10)).replace('set role service_role',`set role ${role}`),/permission denied/);
const beforeCodes=countCodes();
reject('stale assignment fails before issuing any code',request(id(10),999),/assignment changed/);
check('failed request creates no token',countCodes(),beforeCodes);
const requested=json(request(id(10)));
check('request is not activation',requested.state,'requested');
check('request exact replay',json(request(id(10))),requested);
check('request contains no secret',/token|cipher|secret/i.test(JSON.stringify(requested)),false);
reject('only one pending operation per device',request(id(11)),/duplicate key/);
reject('wrong serial rejected before claim',claim(id(10),station,'b'.repeat(64)),/physical recipient/);
reject('browser credential cannot retrieve bootstrap',claim(id(10),browser),/trust required|claimant/);
const prepared=json(claim(id(10)));
check('claim prepared but not active',prepared.status.state,'prepared');
const retriedClaim=json(claim(id(10),station,'a'.repeat(64),{...envelope,ciphertext:'z'.repeat(58)}));
check('claim replay retrieves exact SAME stored envelope',retriedClaim.token_envelope,prepared.token_envelope);
check('lost claim response still consumes a bounded dispatch reservation',retriedClaim.status.attempts,2);
check('claim retries do not mint codes',countCodes(),beforeCodes+1);
reject('another trusted device cannot steal claim',claim(id(10),other),/trust required|already claimed/);
check('manager status excludes envelope',json(service('custodial_activation_read',`${q(id(10))},${q(manager)},${q(browser)}`)),retriedClaim.status);
const receipt=(op,credential,outcome,changed,lin=lineage)=>({operation_id:op,device_id:'KIOSK_08',credential_id:credential,
 flow:changed?'recovery':'enrollment',outcome,changed,journal_schema:'native-assigned-activation.v1',journal_binding_sha256:'d'.repeat(64),lineage_operation_id:lin});
const native=(op,credential,r,hash='e'.repeat(64))=>service('custodial_activation_native_result',`${q(op)},${q(device)},${q(credential)},${q(hash)},${j(r)}`);
reject('workstation cannot fabricate active before native confirmation',native(id(10),healthy,receipt(id(10),healthy,'active',true)),/exact confirmed enrollment/);
reject('invalid device secret cannot report healthy',native(id(10),healthy,receipt(id(10),healthy,'not_required',false),'0'.repeat(64)),/credential required/);
const notRequired=json(native(id(10),healthy,receipt(id(10),healthy,'not_required',false)));
check('authenticated healthy result does not rotate',notRequired.state,'not_required');
check('healthy credential retained',sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id=${q(healthy)};`),'true');
check('terminal clears transport ciphertext',sql(`select (token_envelope is null)::text from public.custodial_assigned_activation_operations where operation_id=${q(id(10))};`),'true');
check('terminal native exact replay',json(native(id(10),healthy,receipt(id(10),healthy,'not_required',false))),notRequired);
reject('terminal receipt cannot be changed',native(id(10),healthy,{...receipt(id(10),healthy,'not_required',false),journal_binding_sha256:'f'.repeat(64)}),/terminal receipt conflict/);

json(request(id(11)));json(claim(id(11)));
const successor=id(12);
const consume=(op=id(11),hash='c'.repeat(64))=>service('device_auth_consume_enrollment_operation',
 `${q(op)},'recovery',${q(device)},${q(hash)},repeat('1',64),${q(successor)},repeat('2',64),'Synthetic recovered phone',now()+interval '1 day',
 repeat('x',64),repeat('i',16),repeat('t',22),now()+interval '20 minutes','synthetic-encrypted-result',null,null,'{"activation_kind":"assigned_device_activation"}'::jsonb`);
reject('token cannot be consumed under another operation',consume(id(99)),/transport operation required/);
reject('wrong token fails before healthy predecessor revocation',consume(id(11),'0'.repeat(64)),/code binding invalid/);
check('failed consumes retain predecessor',sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id=${q(healthy)};`),'true');
const consumed=json(consume());check('exact bound consume commits',consumed.ok,true);
check('consume retry same result credential',json(consume()).credential_id,successor);
check('offline predecessor lineage preserved',sql(`select count(*) from public.custodial_device_credential_replacements where predecessor_credential_id=${q(healthy)} and successor_credential_id=${q(successor)};`),'1');
const confirmed=json(service('device_auth_confirm_enrollment_operation',`${q(id(11))},${q(device)},${q(successor)},repeat('2',64)`));check('server confirms same operation',confirmed.ok,true);
const active=json(native(id(11),successor,receipt(id(11),successor,'active',true),'2'.repeat(64)));
check('post-confirmed exact native receipt becomes active',active.state,'native_active');
check('active receipt exact replay',json(native(id(11),successor,receipt(id(11),successor,'active',true),'2'.repeat(64))),active);
json(request(id(13)));json(claim(id(13)));
sql(`update public.devices set assignment_epoch=assignment_epoch+1 where id=${q(device)};`);
const cancelled=json(service('custodial_activation_read',`${q(id(13))},${q(manager)},${q(browser)}`));
check('assignment change cancels unused operation',cancelled.state,'cancelled');
reject('old assignment token cannot revoke current credential',consume(id(13)),/recipient is stale/);
check('current credential retained after stale consume',sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id=${q(successor)};`),'true');
reject('frozen ledger recipient is immutable',`update public.custodial_assigned_activation_operations set expected_assignment_epoch=999,state_version=state_version+1 where operation_id=${q(id(13))};`,/terminal activation receipt/);

// Test the new private ledger through the existing global recovery fence, not
// just its role grants. Each failed transaction rolls its synthetic pause back.
const pause=`begin;update custodial_dr.restore_control set mutations_paused=true,state='PREPARING',restore_id=${q(id(98))} where singleton=true;`;
check('automatic global table mutation fence exists',sql("select count(*) from pg_trigger where tgrelid='public.custodial_assigned_activation_operations'::regclass and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O';"),'1');
reject('recovery pause denies request before row locking',pause+request(id(20)),/mutations are paused/);
reject('recovery pause denies claim before token issuance',pause+claim(id(13)),/mutations are paused/);
reject('recovery pause denies native receipt mutation',pause+native(id(11),successor,receipt(id(11),successor,'active',true),'2'.repeat(64)),/mutations are paused/);
reject('recovery pause denies status expiry mutation',pause+service('custodial_activation_read',`${q(id(13))},${q(manager)},${q(browser)}`),/mutations are paused/);
json(request(id(20)));const deliveryPrepared=json(claim(id(20)));
const delivery=(version,outcome='delivered')=>service('custodial_activation_delivery',`${q(id(20))},${q(manager)},${q(station)},${q(workstation)},${version},${q(outcome)},null`);
check('delivery acknowledgment never promotes native active',json(delivery(deliveryPrepared.status.state_version)).state,'delivered');
reject('stale delivery version cannot overwrite result',delivery(deliveryPrepared.status.state_version),/stale or invalid/);
for(let attempt=1;attempt<5;attempt++){
 const retry=json(claim(id(20)));
 check('unknown delivery preserves exact token retry '+attempt,retry.token_envelope,envelope);
 check('claim reserves attempt before any delivery report '+attempt,retry.status.attempts,attempt+1);
 json(delivery(retry.status.state_version,'delivery_unknown'));
}
reject('sixth dispatch secret retrieval is bounded',claim(id(20)),/attempt limit/);
reject('delivery without a new reservation is rejected',delivery(json(service('custodial_activation_read',`${q(id(20))},${q(manager)},${q(browser)}`)).state_version),/stale or invalid/);
reject('even owner-side direct update cannot remint same operation token',`update public.custodial_assigned_activation_operations set token_envelope=${j({...envelope,ciphertext:'z'.repeat(58)})},state='delivery_unknown',state_version=state_version+1 where operation_id=${q(id(20))};`,/token cannot rotate/);

const ledger='public.custodial_assigned_activation_operations';
const beforeRecovery=sql(`select jsonb_agg(to_jsonb(a) order by operation_id) from ${ledger} a;`);
const restore=(kind,identity)=>`do $restore$declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(identity)};execute d;end $restore$;`;
const readIdentity=sql("select 'public.custodial_activation_read(uuid,uuid,uuid)'::regprocedure::text;");
sql(`create or replace function public.custodial_activation_read(p_operation uuid,p_manager uuid,p_requester uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $bad$ begin return '{}'::jsonb;end $bad$;`+restore('function',readIdentity));
check('exact function recovery restores original status',json(service('custodial_activation_read',`${q(id(20))},${q(manager)},${q(browser)}`)).state,'delivery_unknown');
sql(`grant select on ${ledger} to anon;grant execute on function ${readIdentity} to public;`+restore('grant',ledger)+restore('grant',readIdentity));
reject('restored table ACL denies direct anonymous read',`set role anon;select * from ${ledger};`,/permission denied/);
reject('restored RPC ACL denies anonymous read',`set role anon;select public.custodial_activation_read(${q(id(20))},${q(manager)},${q(browser)});`,/permission denied/);
for(const trigger of ['trg_custodial_activation_guard_row','custodial_disaster_restore_mutation_fence']){
 sql(`alter table ${ledger} disable trigger ${trigger};`+restore('trigger',`${ledger}.${trigger}`));
 check('exact enabled trigger recovered '+trigger,sql(`select tgenabled from pg_trigger where tgrelid=${q(ledger)}::regclass and tgname=${q(trigger)};`),'O');
}
sql('drop index public.custodial_one_pending_activation_per_device;'+restore('index','public.custodial_one_pending_activation_per_device'));
reject('recovered unique pending constraint still rejects second request',request(id(21)),/duplicate key/);
check('recovery preserves ALL operation and token history',sql(`select jsonb_agg(to_jsonb(a) order by operation_id) from ${ledger} a;`),beforeRecovery);

// Construct an already-expired synthetic request directly, without changing a
// frozen live operation or waiting on wall time. No code is issued to this row.
sql(`update public.devices set assignment_epoch=assignment_epoch+1 where id=${q(device)};
 insert into ${ledger}(operation_id,device_id,canonical_device_id,expected_employee_id,expected_assignment_epoch,
 requested_action,requester_manager_id,requester_credential_id,approved_serial_sha256,requested_at,expires_at)
 values(${q(id(22))},${q(device)},'KIOSK_08',${q(employee)},${epoch()+1},'activate_or_recover',${q(manager)},${q(browser)},repeat('a',64),now()-interval '26 minutes',now()-interval '1 minute');`);
const codesBeforeExpiry=countCodes();
const expired=json(service('custodial_activation_read',`${q(id(22))},${q(manager)},${q(browser)}`));
check('expired request becomes terminal on status read',expired.state,'expired');
check('expired claim returns no envelope',json(claim(id(22))),{status:expired});
check('expired claim never creates a code',countCodes(),codesBeforeExpiry);
check('expiry does not revoke confirmed phone credential',sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id=${q(successor)};`),'true');
check('pending list excludes terminal history',json(service('custodial_activation_list',`${q(manager)},${q(browser)}`)).operations,[]);
reject('pending list denies anonymous callers',`set role anon;select public.custodial_activation_list(${q(manager)},${q(browser)});`,/permission denied/);
const sqlParallel=async query=>{
 const args=['exec',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',`set statement_timeout=30000;${query}`];
 const {stdout}=await promisify(execFile)('docker',args,{timeout:35000,maxBuffer:1024*1024});
 return JSON.parse(stdout.trim().split('\n').at(-1));
};
const concurrentRequests=await Promise.all([sqlParallel(request(id(30))),sqlParallel(request(id(30)))]);
check('two concurrent identical requests return one operation',concurrentRequests[0],concurrentRequests[1]);
const beforeConcurrentCodes=countCodes();
const concurrentClaims=await Promise.all([sqlParallel(claim(id(30))),sqlParallel(claim(id(30),station,'a'.repeat(64),{...envelope,ciphertext:'y'.repeat(58)}))]);
check('two concurrent claims return the same winning envelope',concurrentClaims[0].token_envelope,concurrentClaims[1].token_envelope);
check('concurrent claims reserve distinct bounded attempts',concurrentClaims.map(c=>c.status.attempts).sort(),[1,2]);
check('concurrent claims issue exactly one code',countCodes(),beforeConcurrentCodes+1);
const pendingList=json(service('custodial_activation_list',`${q(manager)},${q(browser)}`));
check('pending list contains only owned current pending status',pendingList.operations,[concurrentClaims.find(c=>c.status.attempts===2).status]);
check('pending listing contains no bootstrap envelope',/token|cipher|secret/i.test(JSON.stringify(pendingList)),false);
for(let i=0;i<3;i++)json(claim(id(30))); // deliberately omit every delivery report
reject('lost client and lost delivery acknowledgments cannot evade attempt bound',claim(id(30)),/attempt limit/);
console.log(JSON.stringify({status:'PASS',checks,realPostgres:true,production:false,independentAudit:false,nativeRuntime:false}));
