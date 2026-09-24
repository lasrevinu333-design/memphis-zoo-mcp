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
const id=n=>`22000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager=id(1),browser=id(2),station=id(3),other=id(4),device=id(5),employee=id(6),healthy=id(7),lineage=id(8);
const workstation='CUSTODIAL-MAINTENANCE-22000000-0000-4000-8000-000000000003';
const envelope={version:'assigned-activation.aes-256-gcm.v1',ciphertext:'c'.repeat(58),iv:'i'.repeat(16),tag:'t'.repeat(22)};
const service=(fn,args)=>`set role service_role;select public.${fn}(${args})::text;`;
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
 values(${q(manager)},'Synthetic Activation Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at)
 values(${q(browser)},'synthetic-browser','Browser',repeat('a',64),'full_access',${q(manager)},now()+interval '1 day'),
 (${q(station)},${q(workstation)},'Maintenance',repeat('b',64),'full_access',${q(manager)},now()+interval '1 day'),
 (${q(other)},'CUSTODIAL-MAINTENANCE-22000000-0000-4000-8000-000000000004','Other workstation',repeat('d',64),'full_access',${q(manager)},now()+interval '1 day');
 insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMP997','Synthetic Activation Custodian','staff',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
 values(${q(device)},'KIOSK_09','Synthetic only KIOSK_09',true,${q(employee)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,created_at)
 values(${q(healthy)},${q(device)},repeat('6',64),'Synthetic healthy phone',now()-interval '1 day',now()+interval '1 day',now()-interval '1 day');
 insert into public.device_auth_enrollment_operations(operation_id,device_id,credential_id,flow,request_fingerprint,status,resume_expires_at,confirmed_at)
 values(${q(lineage)},${q(device)},${q(healthy)},'enrollment',repeat('f',64),'confirmed',now()-interval '1 day',now()-interval '1 day');`);
const epoch=()=>Number(sql(`select assignment_epoch from public.devices where id=${q(device)};`));
const request=(op,ep=epoch())=>service('custodial_activation_request',`${q(op)},'KIOSK_09',${q(employee)},${ep},${q(manager)},${q(browser)},repeat('a',64)`);
const claim=(op,cred=station,serial='a'.repeat(64),enc=envelope)=>service('custodial_activation_claim',
 `${q(op)},${q(manager)},${q(cred)},${q(workstation)},${q(serial)},'custodial-maintenance-v1',repeat('c',64),${j(enc)}`);
const countCodes=()=>Number(sql('select count(*) from public.device_auth_enrollment_codes;'));

const table='public.custodial_activation_legacy_lineage_bindings',digest='d'.repeat(64);
let nextRequest=100;
const bind=(op,cred=healthy,hash='6'.repeat(64),dig=digest,req=id(nextRequest++))=>service('custodial_legacy_activation_bind',
 `${q(op)},${q(device)},${q(cred)},${q(hash)},${q(dig)},${q(req)},repeat('a',64)`);
const receipt=(op,b,recovered=false)=>({operation_id:op,device_id:'KIOSK_09',credential_id:b.credential_id,
 outcome:recovered?'active':'not_required',changed:recovered,transition:recovered?'confirmed_recovery':'healthy_no_change',
 journal_schema:'native-assigned-activation-legacy.v1',journal_binding_sha256:'b'.repeat(64),
 legacy_binding_id:b.binding_id,legacy_binding_kind:b.binding_kind,installation_binding_sha256:b.installation_binding_sha256});
const terminal=(op,b,r=receipt(op,b),hash='6'.repeat(64))=>service('custodial_legacy_activation_result',
 `${q(op)},${q(device)},${q(b.credential_id)},${q(hash)},${j(r)}`);
for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
 reject('legacy direct table denied '+role,`set role ${role};select * from ${table};`,/permission denied/);
for(const role of ['anon','authenticated','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
 for(const name of ['custodial_legacy_activation_bind','custodial_legacy_activation_result'])
  reject('legacy RPC denied '+role+'/'+name,name.endsWith('_bind')?bind(id(10)).replace('set role service_role',`set role ${role}`):
   service(name,`${q(id(10))},${q(device)},${q(healthy)},repeat('6',64),'{}'::jsonb`).replace('set role service_role',`set role ${role}`),/permission denied/);
json(request(id(10)));
reject('unclaimed operation cannot mint binding',bind(id(10)),/not pending/);
json(claim(id(10)));
reject('wrong current token cannot mint',bind(id(10),healthy,'0'.repeat(64)),/current exact assigned/);
const b=json(bind(id(10)));
check('true legacy uses present observation',b.binding_kind,'authenticated_legacy_installation_observation');
check('no historical enrollment invented',b.source_enrollment_operation_id,null);
check('healthy has no recovery operation',b.current_recovery_operation_id,null);
check('same operation retries preserve exact server record',json(bind(id(10))),b);
reject('same operation cannot rebind installation',bind(id(10),healthy,'6'.repeat(64),'c'.repeat(64)),/binding conflict/);
check('healthy binding did not rotate credential',sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id=${q(healthy)}`),'true');
const success=json(terminal(id(10),b));
check('legacy healthy terminal accepted',success.status.state,'not_required');
check('server receipt bound exact binding',success.binding,b);
check('terminal response lost replay stable',json(terminal(id(10),b)),success);
check('binding response replay after terminal stable',json(bind(id(10))),b);
for(const [key,value] of Object.entries({legacy_binding_id:id(99),legacy_binding_kind:'confirmed_enrollment_operation',
 installation_binding_sha256:'f'.repeat(64),changed:true,transition:'confirmed_recovery',outcome:'active',extra:'not-allowed',
 journal_schema:'native-assigned-activation.v1'}))
 reject('strict receipt rejects '+key,terminal(id(10),b,{...receipt(id(10),b),[key]:value}),/exact bounded/);
reject('terminal receipt immutable',terminal(id(10),b,{...receipt(id(10),b),journal_binding_sha256:'f'.repeat(64)}),/terminal receipt conflict/);
reject('observation cannot update',`update ${table} set installation_binding_sha256=repeat('f',64) where binding_id=${q(b.binding_id)}`,/immutable/);
reject('observation cannot delete',`delete from ${table} where binding_id=${q(b.binding_id)}`,/immutable/);
check('observation created no work predecessor edge',sql(`select count(*) from public.custodial_device_credential_replacements where successor_credential_id=${q(healthy)}`),'0');
// An exact metadata-linked confirmed original is a different explicit kind.
sql(`update public.device_auth_credentials set metadata_json=jsonb_build_object('enrollment_operation_id',${q(lineage)},'enrollment_flow','enrollment') where credential_id=${q(healthy)}`);
json(request(id(11)));json(claim(id(11)));const original=json(bind(id(11)));
check('exact original metadata qualifies',original.binding_kind,'confirmed_enrollment_operation');
check('confirmed source exact operation',original.source_enrollment_operation_id,lineage);
json(terminal(id(11),original));
// Current recovery binds only the exact manager operation and replacement.
json(request(id(12)));json(claim(id(12)));
const successor=id(13);
json(service('device_auth_consume_enrollment_operation',
 `${q(id(12))},'recovery',${q(device)},repeat('c',64),repeat('1',64),${q(successor)},repeat('7',64),'Synthetic legacy recovery',now()+interval '1 day',
 repeat('x',64),repeat('i',16),repeat('t',22),now()+interval '20 minutes','synthetic-encrypted-result',null,null,'{"activation_kind":"assigned_device_activation"}'::jsonb`));
reject('unconfirmed replacement cannot bind',bind(id(12),successor,'7'.repeat(64)),/current exact assigned/);
json(service('device_auth_confirm_enrollment_operation',`${q(id(12))},${q(device)},${q(successor)},repeat('7',64)`));
const recovered=json(bind(id(12),successor,'7'.repeat(64)));
check('recovery is not original enrollment',recovered.binding_kind,'authenticated_legacy_installation_observation');
check('recovery has no manufactured original',recovered.source_enrollment_operation_id,null);
check('recovery references exact manager operation',recovered.current_recovery_operation_id,id(12));
const active=json(terminal(id(12),recovered,receipt(id(12),recovered,true),'7'.repeat(64)));
check('confirmed legacy recovery terminal accepted',active.status.state,'native_active');
check('confirmed recovery exact terminal replay',json(terminal(id(12),recovered,receipt(id(12),recovered,true),'7'.repeat(64))),active);
reject('old credential cannot reuse old observation',bind(id(10)),/current exact assigned/);
check('existing replacement edge remains exact',sql(`select count(*) from public.custodial_device_credential_replacements where predecessor_credential_id=${q(healthy)} and successor_credential_id=${q(successor)}`),'1');
check('observation UUID is not work credential authority',sql(`select public.custodial_credential_may_transmit_frozen_work(${q(b.binding_id)},${q(successor)},${q(device)},now())::text`),'false');
// Same operation concurrent valid retries, different request attestations.
json(request(id(14)));json(claim(id(14)));
const parallel=promisify(execFile),query=bind(id(14),successor,'7'.repeat(64));
const concurrent=await Promise.all([query,query].map(s=>parallel('docker',['exec',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',s],{timeout:35000}).then(r=>JSON.parse(r.stdout.trim().split('\n').at(-1)))));
check('concurrent bind exact single immutable row',concurrent[0],concurrent[1]);
const newer=concurrent[0];check('later activation new binding ID',newer.binding_id===recovered.binding_id,false);
const pause=`begin;update custodial_dr.restore_control set mutations_paused=true,state='PREPARING',restore_id=${q(id(98))} where singleton=true;`;
reject('bind obeys pre-lock mutation fence',pause+bind(id(14),successor,'7'.repeat(64)),/mutations are paused/);
reject('result obeys pre-lock mutation fence',pause+terminal(id(14),newer,receipt(id(14),newer),'7'.repeat(64)),/mutations are paused/);
check('legacy table forced RLS',sql(`select (relrowsecurity and relforcerowsecurity)::text from pg_class where oid=${q(table)}::regclass`),'true');
check('global mutation trigger installed',sql(`select count(*) from pg_trigger where tgrelid=${q(table)}::regclass and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O'`),'1');
const before=sql(`select jsonb_agg(to_jsonb(b) order by binding_id) from ${table} b`);
const restore=(kind,identity)=>`do $r$declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(identity)};execute d;end$r$;`;
const resolver=sql("select 'public.custodial_legacy_activation_bind(uuid,uuid,uuid,text,text,uuid,text)'::regprocedure::text");
sql(`grant select on ${table} to anon;grant execute on function ${resolver} to public;`+restore('grant',table)+restore('grant',resolver));
reject('recovered table ACL denied',`set role anon;select * from ${table}`,/permission denied/);
reject('recovered function ACL denied',bind(id(14),successor,'7'.repeat(64)).replace('set role service_role','set role anon'),/permission denied/);
sql(`alter table ${table} disable trigger trg_custodial_legacy_activation_guard;`+restore('trigger',table+'.trg_custodial_legacy_activation_guard'));
reject('recovered immutable trigger enforced',`delete from ${table}`,/immutable/);
sql(restore('function',resolver));
check('restored resolver returns exact binding',json(bind(id(14),successor,'7'.repeat(64))),newer);
check('recovery preserves all original observation rows',sql(`select jsonb_agg(to_jsonb(b) order by binding_id) from ${table} b`),before);
for(const [label,update] of [
 ['expired credential',`update public.device_auth_credentials set created_at=now()-interval '1 day',expires_at=now()-interval '1 minute' where credential_id=${q(successor)}`],
 ['revoked credential',`update public.device_auth_credentials set revoked_at=now() where credential_id=${q(successor)}`],
 ['inactive employee',`update public.employees set active=false where id=${q(employee)}`],
 ['inactive device',`update public.devices set active=false where id=${q(device)}`],
])reject('observed binding refuses '+label,`begin;${update};`+bind(id(14),successor,'7'.repeat(64)),/current exact assigned/);
json(terminal(id(14),newer,receipt(id(14),newer),'7'.repeat(64)));
// A new current recovery may succeed after an independently revoked predecessor,
// but the new installation observation must not manufacture its missing work edge.
sql(`update public.device_auth_credentials set revoked_at=now()-interval '1 hour' where credential_id=${q(successor)};`);
json(request(id(16)));json(claim(id(16)));const unlinked=id(17);
json(service('device_auth_consume_enrollment_operation',
 `${q(id(16))},'recovery',${q(device)},repeat('c',64),repeat('1',64),${q(unlinked)},repeat('8',64),'Synthetic previously revoked legacy',now()+interval '1 day',
 repeat('x',64),repeat('i',16),repeat('t',22),now()+interval '20 minutes','synthetic-encrypted-result',null,null,'{"activation_kind":"assigned_device_activation"}'::jsonb`));
json(service('device_auth_confirm_enrollment_operation',`${q(id(16))},${q(device)},${q(unlinked)},repeat('8',64)`));
const unlinkedBinding=json(bind(id(16),unlinked,'8'.repeat(64)));
check('already revoked predecessor still permits current identity recovery',json(terminal(id(16),unlinkedBinding,receipt(id(16),unlinkedBinding,true),'8'.repeat(64))).status.state,'native_active');
check('current observation does not invent missing predecessor edge',sql(`select count(*) from public.custodial_device_credential_replacements where predecessor_credential_id=${q(successor)} and successor_credential_id=${q(unlinked)}`),'0');
check('old frozen work remains blocked without predecessor proof',sql(`select public.custodial_credential_may_transmit_frozen_work(${q(successor)},${q(unlinked)},${q(device)},now()-interval '2 hours')::text`),'false');
// Fixture is born expired; never rewrite a frozen operation to simulate time.
sql(`insert into public.custodial_assigned_activation_operations(operation_id,device_id,canonical_device_id,expected_employee_id,expected_assignment_epoch,
 requested_action,requester_manager_id,requester_credential_id,approved_serial_sha256,requested_at,expires_at)
 values(${q(id(18))},${q(device)},'KIOSK_09',${q(employee)},${epoch()},'activate_or_recover',${q(manager)},${q(browser)},repeat('a',64),now()-interval '26 minutes',now()-interval '1 minute');`);
reject('expired operation cannot mint observation',bind(id(18),unlinked,'8'.repeat(64)),/not pending/);
check('expiry refusal adds no binding',sql(`select count(*) from ${table} where activation_operation_id=${q(id(18))}`),'0');
sql(`update public.devices set assignment_epoch=assignment_epoch+1 where id=${q(device)}`);
reject('changed assignment cannot reuse terminal binding',bind(id(16),unlinked,'8'.repeat(64)),/current exact assigned/);
console.log(JSON.stringify({status:'PASS',checks,actualPostgres:true,synthetic:true,production:false,independentAudit:false}));
