import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {validateNativeProviderEventDecisions} from '../../src/native-provider-event-decisions.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
export const NATIVE_EVENT_DECISION_RPC='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';
export const NATIVE_EVENT_DECISION_MIGRATION='20261004000000_native_provider_event_decision_lookup.sql';
const directTables=['employee_native_provider_events','employee_native_provider_event_requests','employee_native_push_delivery_receipts'];
// Aug13 U4: existing delivery table FORCE-RLS/client revoked. Aug20 133000:
// trusted NOLOGIN/NOBYPASSRLS application reader receives SELECT, no row policy.
// Oct3 050000 explicitly revokes that role on the two NEW event tables.
// Never confuse successful LIMIT0 (privilege) with visibility of a receipt.
export const NATIVE_EVENT_DECISION_DENIED_READS=Object.freeze([
 ...['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'].flatMap(role=>directTables.map(table=>Object.freeze([role,table]))),
 ...directTables.slice(0,2).map(table=>Object.freeze(['custodial_application_reader',table])),
]);
const deliveryGrantSha='7aced0abd578cfce5bd83b2763e395a3618390790319a4c85d17eb7f7a48ee07';
/** Pure checker reused by hostile-data tests; only the owning SQL fixture below
 * supplies actual catalog, owner-visible count and SET ROLE reader row count. */
export function assertNativeEventDecisionAccess(value){
 assert.deepEqual(Object.keys(value).sort(),['delivery_recovery','reader','relations','rpc','visibility']);
 assert.deepEqual(value.reader,{name:'custodial_application_reader',superuser:false,create_db:false,create_role:false,inherit:false,login:false,replication:false,bypassrls:false});
 const aclSort=rows=>[...rows].sort((a,b)=>`${a.grantee}:${a.privilege}:${a.grantable}`.localeCompare(`${b.grantee}:${b.privilege}:${b.grantable}`));
 const ownerAcl=['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'].map(privilege=>({grantee:'postgres',privilege,grantable:false}));
 const expected=directTables.map(name=>({identity:'public.'+name,owner:'postgres',rls:true,force_rls:true,policies:[],
  acl:aclSort([...ownerAcl,...(name==='employee_native_push_delivery_receipts'?[{grantee:'custodial_application_reader',privilege:'SELECT',grantable:false}]:[])])}));
 const relationSort=rows=>[...rows].sort((a,b)=>a.identity.localeCompare(b.identity));
 assert.deepEqual(relationSort(value.relations.map(r=>({...r,acl:aclSort(r.acl)}))),relationSort(expected));
 assert.deepEqual({...value.rpc,acl:aclSort(value.rpc.acl)},{identity:NATIVE_EVENT_DECISION_RPC,owner:'postgres',acl:aclSort(['postgres','service_role'].map(grantee=>({grantee,privilege:'EXECUTE',grantable:false})))});
 assert.deepEqual(Object.keys(value.visibility).sort(),['owner_rows','reader_rows']);assert.ok(Number.isSafeInteger(value.visibility.owner_rows)&&value.visibility.owner_rows>0);assert.equal(value.visibility.reader_rows,0);
 assert.deepEqual(value.delivery_recovery,{identity:'public.employee_native_push_delivery_receipts',recorded_sha256:deliveryGrantSha,stored_sha256:deliveryGrantSha,current_sha256:deliveryGrantSha,definition_equal:true});
 return true;
}
const tables=['devices','employees','device_auth_credentials','employee_push_registrations','employee_native_push_generations',
 'employee_native_push_delivery_receipts','employee_native_provider_events','employee_native_provider_event_requests',
 'operational_notification_jobs','device_notification_acknowledgements','sessions','system_feedback_items',
 'custodial_release_authority_restore_inventory'];

/** NO top-level execution, subprocess, connection, schema helper or container.
 * Call only from the owning network-none/no-default-table-grants replay, just
 * AFTER its actual original four-event `admitted` result and BEFORE destructive
 * fixture scenarios. Root owns that runner import/invocation. The current
 * credential lifetime is extended ONLY inside each rolled-back synthetic case;
 * no caller clock, fabricated receipt or record replacement is used.
 * This export is prepared test capability, not evidence of an executed test.
 */
export function nativeProviderEventDecisionDatabaseCases({scope,sql,q,j,check,reject,credential,credentialHash,body,request,admitted}){
 assert.equal(scope,'network-none-synthetic-no-auto-grants');
 assert.equal(body.native_app.version_name,'synthetic');
 assert.match(body.token,/^synthetic-/);
 assert.equal(body.credential_id,credential);
 assert.equal(request.events.length,4);
 assert.deepEqual(new Set(request.events.map(e=>e.action)),new Set(['received','displayed','opened','acknowledged']));
 assert.ok(admitted.data.results.every(e=>e.admitted_state==='ACCEPTED'));
 const requester={current_generation_id:body.generation_id,credential_id:credential,employee_id:body.employee_id,
  device_id:body.device_id,assignment_epoch:body.assignment_epoch,principal_digest:body.principal_digest,token_digest:body.token_digest};
 const input={schema:'custodial.native-provider-event-decision-query.v1',requester,events:request.events};
 const first=request.events[0],nonce=randomUUID(),raw=digest(JSON.stringify(input)),attestation='b'.repeat(64);
 const context={credentialId:credential,credentialHash,nativeRequestId:nonce,attestationDigest:attestation,rawBodySha256:raw};
 const snapshotSql='select jsonb_build_object('+tables.map(t=>`${q(t)},(select public.static_weekly_digest_text(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text) from public.${t} r)`).join(',')+');';
 const baseline=sql(snapshotSql);
 const unchanged=name=>check(name+' preserves all protected fixture/recovery rows',sql(snapshotSql),baseline);
 const setup=`update public.device_auth_credentials set expires_at=greatest(expires_at,clock_timestamp()+interval '1 day') where credential_id=${q(credential)};`;
 const call=(b=input,{id=nonce,hash=credentialHash,proof=attestation,rawHash=digest(JSON.stringify(b))}={})=>
  `select public.custodial_native_provider_event_decisions(${[q(credential),q(hash),q(id),q(proof),q(rawHash),j(b)].join(',')});`;
 const result=(b=input,{before='',...options}={})=>{
  const rows=sql('begin;'+setup+before+snapshotSql+'set local role service_role;'+call(b,options)+'reset role;'+snapshotSql+'rollback;').split('\n').map(x=>JSON.parse(x));
  assert.equal(rows.length,3);check('lookup itself leaves protected bytes unchanged BEFORE rollback',rows[2],rows[0]);
  const value=rows[1];
  validateNativeProviderEventDecisions(value,b,{...context,nativeRequestId:options.id??nonce,rawBodySha256:options.rawHash??digest(JSON.stringify(b))});
  return value;
 };
 const unresolved=v=>v.data.results.every(e=>Object.keys(e).sort().join(',')==='decision,event_id'&&e.decision==='UNRESOLVED');
 const expected=new Map(admitted.data.results.map(e=>[e.event_id,{...e,replayed:true}]));
 const accepted=result();
 check('fixture actually queries historical expired originals, not a test clock',sql(`select bool_and(native_valid_until<clock_timestamp()) from public.employee_native_push_delivery_receipts where job_id in (${request.events.map(e=>q(e.receipt_job_id)).join(',')});`),'t');
 check('actual lookup returns exact original accepted four transitions',accepted.data.results.map(e=>e.receipt),request.events.map(e=>expected.get(e.event_id)));
 check('actual lookup preserves query order, not transition scheduling',accepted.data.results.map(e=>e.event_id),request.events.map(e=>e.event_id));
 check('actual lookup fresh request ID/raw-body digest echo',[accepted.data.native_request_id,accepted.data.request_body_sha256],[nonce,raw]);
 unchanged('successful original lookup');
 const retry=result(input,{id:randomUUID(),rawHash:digest(' \n'+JSON.stringify(input,null,2)+'\n')});
 check('response loss fresh query returns same immutable originals',retry.data.results,accepted.data.results);
 unchanged('response loss readback');
 const missing={...first,event_id:randomUUID()};
 check('absent original does not admit or become terminal',unresolved(result({...input,events:[missing]})),true);
 const changed={...first,original_observation:{...first.original_observation,elapsed_realtime_ms:first.original_observation.elapsed_realtime_ms+1}};
 check('changed original observation does not return another receipt',unresolved(result({...input,events:[changed]})),true);
 check('missing item in mixed batch is unresolved only',result({...input,events:[...request.events.slice(1),missing]}).data.results.at(-1),{event_id:missing.event_id,decision:'UNRESOLVED'});
 for(const [field,value] of [['token_digest','d'.repeat(64)],['generation_id',randomUUID()],['receipt_job_id',randomUUID()],
  ['content_sha256','d'.repeat(64)],['notification_key','synthetic-foreign-original']]){
  const e={...first,[field]:value};e.record_id=digest(e.generation_id+'\n'+e.receipt_job_id+'\n'+e.notification_key);
  check('crossed original '+field+' remains unresolved',unresolved(result({...input,events:[e]})),true);
 }
 for(const [field,value] of [['current_generation_id',randomUUID()],['token_digest','e'.repeat(64)]])
  check('crossed current '+field+' discloses no accepted fact',unresolved(result({...input,requester:{...requester,[field]:value}})),true);
 for(const [name,before] of [
  ['credential revocation',`update public.device_auth_credentials set revoked_at=clock_timestamp() where credential_id=${q(credential)};`],
  ['credential expiry',`update public.device_auth_credentials set expires_at=clock_timestamp()-interval '1 second' where credential_id=${q(credential)};`],
  ['inactive device',`update public.devices set active=false where device_id=${q(body.device_id)};`],
  ['inactive employee',`update public.employees set active=false where id=${q(body.employee_id)};`],
  ['assignment epoch change',`update public.devices set assignment_epoch=assignment_epoch+1 where device_id=${q(body.device_id)};`],
  ['registration removal',`update public.employee_push_registrations set active=false,revoked_at=clock_timestamp(),revoked_reason='synthetic removal' where registration_id=(select registration_id from public.employee_native_push_generations where generation_id=${q(body.generation_id)});`],
  ['retired current generation without successor',`update public.employee_native_push_generations set dispatch_retired_at=clock_timestamp() where generation_id=${q(body.generation_id)};`],
 ]){
  check(name+' yields only unresolved',unresolved(result(input,{before})),true);unchanged(name);
 }
 check('wrong credential proof yields only unresolved',unresolved(result(input,{hash:'f'.repeat(64)})),true);
 for(const field of ['credential_id','employee_id','device_id','assignment_epoch','principal_digest']){
  const b=structuredClone(input);b.requester[field]=field==='device_id'?'KIOSK_09':field==='assignment_epoch'?2:field==='principal_digest'?'e'.repeat(64):randomUUID();
  reject('SQL crossed query principal '+field,'begin;'+setup+call(b)+'rollback;',/exact native requester identity|one exact original query principal/);
 }
 for(const b of [{...input,extra:true},{...input,events:[]},{...input,events:Array(17).fill(first)},
  {...input,events:[first,first]},{...input,requester:{...requester,extra:true}},
  {...input,requester:{...requester,assignment_epoch:'1'}}])
  reject('SQL strict decision query shape','begin;'+setup+call(b)+'rollback;',/exact native|unique original/);
 reject('SQL rejects local Dismiss as unsupported event','begin;'+setup+call({...input,events:[{...first,action:'dismissed'}]})+'rollback;',/^ERROR: {1,2}exact finite native event required\n?$/);
 for(const options of [{proof:''},{rawHash:''},{rawHash:'A'.repeat(64)}])
  reject('SQL exact fresh proof context shape','begin;'+setup+call(input,options)+'rollback;',/exact native original event query/);
 unchanged('all negative cases');

 // Real official token rotation inside a rollback, not a hand-edited generation.
 // The original event/reservation bytes stay fixed. An old CURRENT requester
 // cannot use retirement to impersonate the new active generation.
 const rotated={...body,operation_id:randomUUID(),generation_id:randomUUID(),token:'synthetic-decision-rotated-token-not-production'};
 rotated.token_digest=digest(rotated.token);
 const rotation=`do $rotation$ begin perform public.custodial_native_provider_registration(${q(credential)},${q(credentialHash)},${q(randomUUID())},${q(attestation)},${j(rotated)},false);end $rotation$;`;
 const rotatedInput={...input,requester:{...requester,current_generation_id:rotated.generation_id,token_digest:rotated.token_digest}};
 const rotatedResult=result(rotatedInput,{before:rotation});
 check('same-principal official rotation drains original receipts without rebind',rotatedResult.data.results,accepted.data.results);
 check('old current-generation requester after rotation is unresolved',unresolved(result(input,{before:rotation})),true);
 check('revoked original cannot drain through current successor',unresolved(result(rotatedInput,{before:rotation+
  `update public.employee_native_push_generations set revoked_at=clock_timestamp() where generation_id=${q(body.generation_id)};`})),true);
 const foreign={...rotated,principal_digest:'f'.repeat(64)};
 const foreignRotation=`do $rotation$ begin perform public.custodial_native_provider_registration(${q(credential)},${q(credentialHash)},${q(randomUUID())},${q(attestation)},${j(foreign)},false);end $rotation$;`;
 check('different protected principal cannot drain an old principal',unresolved(result(rotatedInput,{before:foreignRotation})),true);
 unchanged('all rotation cases');

 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])
  reject(role+' denied lookup RPC','set role '+role+';'+call(),/permission denied/);
 for(const [role,table] of NATIVE_EVENT_DECISION_DENIED_READS)
  reject(role+' denied direct original read '+table,'set role '+role+';select * from public.'+table+' limit 0;',/permission denied/);
 // Complete source-derived ACL/role/RLS matrix, not learned from surviving
 // privileges. The old reader grant also matches the retained NORMAL216 exact
 // grant row900047; no runtime grant or policy is modified for this proof.
 const acl=(column,owner)=>`(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(${column},acldefault(${owner}))) a)`;
 const authority=JSON.parse(sql(`select jsonb_build_object(
 'reader',(select jsonb_build_object('name',rolname,'superuser',rolsuper,'create_db',rolcreatedb,'create_role',rolcreaterole,'inherit',rolinherit,'login',rolcanlogin,'replication',rolreplication,'bypassrls',rolbypassrls) from pg_roles where rolname='custodial_application_reader'),
 'relations',(select jsonb_agg(jsonb_build_object('identity','public.'||c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'policies',(select coalesce(jsonb_agg(p.polname order by p.polname),'[]'::jsonb) from pg_policy p where p.polrelid=c.oid),'acl',${acl('c.relacl',"'r',c.relowner")})) from pg_class c where c.oid in (${directTables.map(t=>q('public.'+t)+'::regclass').join(',')})),
 'rpc',(select jsonb_build_object('identity',${q(NATIVE_EVENT_DECISION_RPC)},'owner',pg_get_userbyid(p.proowner),'acl',${acl('p.proacl',"'f',p.proowner")}) from pg_proc p where p.oid=${q(NATIVE_EVENT_DECISION_RPC)}::regprocedure),
 'delivery_recovery',(select jsonb_build_object('identity',object_identity,'recorded_sha256',definition_sha256,'stored_sha256',public.static_weekly_digest_text(definition_sql),'current_sha256',public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity)),'definition_equal',definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='public.employee_native_push_delivery_receipts'));`));
 authority.visibility={owner_rows:Number(sql('select count(*) from public.employee_native_push_delivery_receipts;')),
  reader_rows:Number(sql('set role custodial_application_reader;select count(*) from public.employee_native_push_delivery_receipts;'))};
 check('exact source ACL/RLS and non-bypass reader preserve zero row visibility',assertNativeEventDecisionAccess(authority),true);
 check('new wrapper has exactly owner and explicit service EXECUTE',sql(`select coalesce(bool_and(a.grantee in (p.proowner,'service_role'::regrole) and a.privilege_type='EXECUTE'),false) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=${q(NATIVE_EVENT_DECISION_RPC)}::regprocedure;`),'t');
 check('lookup definition contains no record-writing or mutation authority',sql(`select position('custodial_begin_application_mutation(' in pg_get_functiondef(${q(NATIVE_EVENT_DECISION_RPC)}::regprocedure))=0;`),'t');
 for(const kind of ['function','grant']){
  check('source-required '+kind+' exact canary member',sql(`select count(*) from public.custodial_release_canary_authority_surface() where object_kind=${q(kind)} and object_identity=${q(NATIVE_EVENT_DECISION_RPC)};`),'1');
  const live=kind==='function'?`pg_get_functiondef(${q(NATIVE_EVENT_DECISION_RPC)}::regprocedure)`:
   `public.custodial_release_authority_current_grant_definition(${q(NATIVE_EVENT_DECISION_RPC)})`;
  check('source-required '+kind+' exact recorded/live recovery bytes',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity=${q(NATIVE_EVENT_DECISION_RPC)} and definition_sql=${live} and definition_sha256=public.static_weekly_digest_text(${live});`),'1');
 }
 check('canary recovery exact after additive membership',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity='custodial_release_canary_authority_surface()' and definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql);`),'1');
 check('inventory immutable trigger remains enabled',sql("select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable';"),'O');
 unchanged('role/recovery readbacks');
 return {schema:'custodial.native-provider-event-decision-db-fixture.v1',scope,request:input,response:accepted,retry,rotatedRequest:rotatedInput,
  rotatedResponse:rotatedResult,accessMatrix:authority,actualSql:true,actualHttp:false,fullControllerRestore:false,terminalDisposition:false,activation:false,
  limitations:['Full218 no-auto replay and normal controller restore remain owning-runner gates, not inferred from this fixture.']};
}
