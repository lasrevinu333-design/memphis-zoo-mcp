import { isDeepStrictEqual } from 'node:util';
import { verifyNativeDeviceRequestAttestation } from './auth/device-credential-auth.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCHEMA = 'custodial.employee-original-message-outcome.v1';
const COMMON = ['device_id','expected_employee_id','expected_credential_id','expected_assignment_epoch'];
const COMMANDS = Object.freeze({send:'employee_message_original_send',read:'employee_message_original_read',delete:'employee_message_original_delete'});
const SEND_RESULT_KEYS = ['id','thread_id','sender_user_id','message_type','body','metadata_json','sent_at','created_at',
  'is_deleted','client_message_id','updated_at','deleted_at','deleted_by_user_id','purge_after'];
const trimSqlText = value => value.replace(/^ +| +$/g,'');
const error = (status, message) => Object.assign(new Error(message), {status});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => object(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const epoch = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) && BigInt(value) <= 9007199254740991n;
function micros(value) {
  if (typeof value!=='string') return null;
  const m=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!m) return null;
  const [,y,mo,da,h,mi,s,f='',zone,zh='0',zm='0']=m;
  const year=Number(y),month=Number(mo),day=Number(da),leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year<1 || month<1 || month>12 || day<1 || day>days[month-1] || Number(h)>23
    || Number(mi)>59 || Number(s)>59 || Number(zh)>23 || Number(zm)>59) return null;
  const ms=Date.parse(`${y}-${mo}-${da}T${h}:${mi}:${s}${zone}`);
  return Number.isFinite(ms)?BigInt(ms)*1000n+BigInt(f.padEnd(6,'0')):null;
}
function json(value,transport=false) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && Object.getPrototypeOf(value)===Array.prototype) {
    const keys=Reflect.ownKeys(value);
    if (keys.length!==value.length+1 || !keys.includes('length')) throw error(422,'Original Messenger arrays must contain ordinary JSON fields.');
    const copy=[];
    for(let i=0;i<value.length;i++) {
      const field=Object.getOwnPropertyDescriptor(value,String(i));
      if (!field || !field.enumerable || !Object.hasOwn(field,'value')) throw error(422,'Original Messenger array accessors are not allowed.');
      copy.push(json(field.value,transport));
    }
    return copy;
  }
  const prototype=value && typeof value==='object'?Object.getPrototypeOf(value):undefined;
  if (object(value) || (transport && prototype===null)) {
    const copy = Object.create(prototype);
    for (const key of Reflect.ownKeys(value)) {
      const field=Object.getOwnPropertyDescriptor(value,key);
      if (typeof key!=='string' || !field.enumerable || !Object.hasOwn(field,'value')) throw error(422,'Original Messenger fields must be own JSON data.');
      Object.defineProperty(copy,key,{value:json(field.value,transport),enumerable:true,writable:true,configurable:true});
    }
    return copy;
  }
  throw error(422, 'Original Messenger transcript must be JSON.');
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function principal(req) {
  const a=req.memphisDeviceAuth,d=req.memphisDevice,c=req.memphisDeviceCredential;
  const assignmentEpoch=typeof d?.assignment_epoch === 'number' && Number.isSafeInteger(d.assignment_epoch)
    ? String(d.assignment_epoch) : d?.assignment_epoch;
  if (req.memphisAuth || a?.ok !== true || a.credentialed !== true || a.offline_recovery_only === true
    || a.device !== d || a.credential !== c || d?.device_active !== true || d.employee_active !== true
    || !UUID.test(d.canonical_device_pk) || !UUID.test(d.assigned_employee_id)
    || typeof d.canonical_device_id !== 'string' || !/^[A-Z0-9_-]{1,64}$/.test(d.canonical_device_id)
    || !epoch(assignmentEpoch) || !UUID.test(c?.credential_id) || c.device_id !== d.canonical_device_pk
    || !HASH.test(c.token_hash) || !c.confirmed_at || c.revoked_at !== null
    || !Number.isFinite(Date.parse(c.expires_at)) || Date.parse(c.expires_at) <= Date.now()) {
    throw error(401, 'Current enrolled employee credential is required for original Messenger outcomes.');
  }
  return freeze({device_pk:d.canonical_device_pk,device_id:d.canonical_device_id,employee_id:d.assigned_employee_id,
    credential_id:c.credential_id,assignment_epoch:assignmentEpoch,token_hash:c.token_hash});
}
function capture(req) {
  // Capture selectors AND credential-bearing headers before the first await.
  const captured=Object.create(Object.getPrototypeOf(req));
  Object.assign(captured, req);
  for (const key of ['body','query','params','headers']) Object.defineProperty(captured,key,
    {value:freeze(json(req[key] || {},key!=='body')),writable:false,configurable:false,enumerable:true});
  for (const key of ['method','url','originalUrl']) Object.defineProperty(captured,key,
    {value:req[key],writable:false,configurable:false,enumerable:true});
  if (Buffer.isBuffer(req.scanAuthorityRawBody)) captured.scanAuthorityRawBody=Buffer.from(req.scanAuthorityRawBody);
  return captured;
}
function assertTranscript(req,captured) {
  if (['body','query','params','headers'].some(key=>!isDeepStrictEqual(json(req[key] || {},key!=='body'),captured[key]))
    || ['method','url','originalUrl'].some(key=>req[key]!==captured[key])
    || !isDeepStrictEqual(req.scanAuthorityRawBody,captured.scanAuthorityRawBody)) {
    throw error(409,'Original Messenger request transcript changed during request.');
  }
}
function middleware(requireDeviceAccess, req, res) {
  return new Promise((resolve,reject) => {
    let settled=false;
    const finish=(allowed, failure) => {
      if (settled) return;
      settled=true; res.removeListener('finish', closed); res.removeListener('close', closed);
      if (failure) reject(failure); else resolve(allowed);
    };
    const closed=()=>finish(false);
    res.once('finish',closed); res.once('close',closed);
    try {
      // The existing manager/device wrapper starts async middleware but returns
      // undefined. Only next() or the response lifecycle is an admission result.
      Promise.resolve(requireDeviceAccess(req,res,()=>finish(true))).catch(failure=>finish(false,failure));
    } catch (failure) { finish(false,failure); }
    if (res.headersSent || res.writableEnded || res.destroyed) finish(false);
  });
}
function originalPayload(req, actor, kind) {
  const b=req.body, userKey=kind==='send'?'sender_user_id':'user_id';
  const actionKeys=kind==='send'?['body','message_type','metadata_json','client_message_id']
    :kind==='read'?['through_message_id']:['operation_id'];
  const allowed=[...COMMON,userKey,...actionKeys];
  if (!exact(b,allowed) || !UUID.test(req.params.threadId) || !UUID.test(b[userKey])
    || !UUID.test(b.expected_employee_id) || !UUID.test(b.expected_credential_id) || !epoch(b.expected_assignment_epoch)) {
    throw error(422,'Closed original Messenger action body is required.');
  }
  if (b.device_id!==actor.device_id || b.expected_employee_id!==actor.employee_id
    || b.expected_credential_id!==actor.credential_id || b.expected_assignment_epoch!==actor.assignment_epoch) {
    throw error(409,'Original Messenger device assignment or credential no longer matches.');
  }
  if (kind==='send' && (typeof b.body!=='string' || !trimSqlText(b.body) || Array.from(trimSqlText(b.body)).length>2000
    || b.message_type!=='text' || !object(b.metadata_json) || typeof b.client_message_id!=='string'
    || !b.client_message_id.trim() || Array.from(b.client_message_id).length>200
    || b.client_message_id!==b.client_message_id.trim())) throw error(422,'Exact text send body and client message ID are required.');
  if (kind==='send' && (Object.hasOwn(b.metadata_json,'authenticated_ops_manager_id')
    || (Object.hasOwn(b.metadata_json,'client_message_id') && b.metadata_json.client_message_id!==b.client_message_id))) {
    throw error(422,'Send metadata conflicts with the original employee message.');
  }
  if (kind==='read' && !UUID.test(b.through_message_id)) throw error(422,'Original read horizon is required.');
  if (kind==='delete' && !UUID.test(b.operation_id)) throw error(422,'Original deletion operation is required.');
  const payload={device_id:actor.device_id,expected_employee_id:actor.employee_id,expected_credential_id:actor.credential_id,
    expected_assignment_epoch:actor.assignment_epoch,user_id:b[userKey],thread_id:req.params.threadId,
    credential_token_hash:actor.token_hash};
  for (const key of actionKeys) payload[key]=b[key];
  if (Buffer.byteLength(JSON.stringify(payload),'utf8')>30000) throw error(422,'Original Messenger payload exceeds its bounded storage.');
  return freeze(payload);
}
function validateOutcome(raw, payload, kind, queryOnly, actor) {
  if (!object(raw)) throw error(502,'Malformed original Messenger outcome.');
  const common=['schema','state','request_fingerprint','original_command','original_actor','original_outcome_recorded',
    'inventory_acknowledged','finalizer_allowed','key_removal'];
  const recorded=raw.state==='ORIGINAL_TRANSACTION_OUTCOME_RECORDED';
  const unknown=raw.state==='ORIGINAL_OUTCOME_NOT_FOUND_UNKNOWN';
  const keys=[...common,...(recorded?['original_request','result','recorded_at']:['resend_allowed'])];
  const expectedActor={device_pk:actor.device_pk,device_id:actor.device_id,employee_id:actor.employee_id,
    credential_id:actor.credential_id,assignment_epoch:actor.assignment_epoch,user_id:payload.user_id};
  const expectedRequest={...payload}; delete expectedRequest.credential_token_hash;
  if (!exact(raw,keys) || raw.schema!==SCHEMA || !HASH.test(raw.request_fingerprint)
    || raw.original_command!==COMMANDS[kind] || !isDeepStrictEqual(raw.original_actor,expectedActor)
    || raw.original_outcome_recorded!==recorded || raw.inventory_acknowledged!==false
    || raw.finalizer_allowed!==false || raw.key_removal!==false || (!recorded && (!unknown || !queryOnly || raw.resend_allowed!==false))) {
    throw error(502,'Unconfirmed original Messenger outcome.');
  }
  if (!recorded) return freeze(json(raw));
  if (!isDeepStrictEqual(raw.original_request,expectedRequest) || micros(raw.recorded_at)===null) {
    throw error(502,'Original Messenger outcome request does not match.');
  }
  const result=raw.result;
  if (kind==='read' && (!exact(result,['marked','thread_id','user_id','through_message_id'])
    || !Number.isSafeInteger(result.marked) || result.marked<0 || result.thread_id!==payload.thread_id
    || result.user_id!==payload.user_id || result.through_message_id!==payload.through_message_id)) throw error(502,'Original read outcome is unconfirmed.');
  const deleteKeys=['ok','deleted','thread_id','operation_id','deletion_scope','deleted_at','deleted_through','replayed'];
  const deleteAllowed=[...deleteKeys,'user_id','memphis_generation_ended'];
  if (kind==='delete' && (!object(result) || !deleteKeys.every(key=>Object.hasOwn(result,key))
    || Object.keys(result).some(key=>!deleteAllowed.includes(key)) || typeof result.replayed!=='boolean'
    || (Object.hasOwn(result,'memphis_generation_ended') && typeof result.memphis_generation_ended!=='boolean')
    || result.ok!==true || result.deleted!==true
    || result.thread_id!==payload.thread_id || result.operation_id!==payload.operation_id || result.deletion_scope!=='user'
    || (Object.hasOwn(result,'user_id') && result.user_id!==payload.user_id)
    || micros(result.deleted_at)===null || micros(result.deleted_through)===null
    || micros(result.deleted_through)<micros(result.deleted_at))) throw error(502,'Original delete outcome is unconfirmed.');
  if (kind==='send' && (!exact(result,SEND_RESULT_KEYS) || !UUID.test(result.id) || result.thread_id!==payload.thread_id
    || result.sender_user_id!==payload.user_id || result.body!==trimSqlText(payload.body) || result.message_type!=='text'
    || result.client_message_id!==payload.client_message_id || result.is_deleted!==false
    || result.deleted_at!==null || result.deleted_by_user_id!==null || result.purge_after!==null
    || micros(result.sent_at)===null || micros(result.created_at)===null || micros(result.updated_at)===null
    || !object(result.metadata_json) || result.metadata_json.client_message_id!==payload.client_message_id)) throw error(502,'Original send outcome is unconfirmed.');
  return freeze(json(raw));
}

// Dependencies are the EXISTING server router boundaries, never client inputs.
// No handler accepts caller auth booleans, arbitrary command names or SQL text.
export function createOriginalMessageActions({runReadOnlySql,runRpc,requireDeviceAccess}={}) {
  if (![runReadOnlySql,runRpc,requireDeviceAccess].every(fn=>typeof fn==='function')) throw new TypeError('Existing SQL, RPC and credential middleware boundaries are required.');
  async function relationship(req,res,actor,actualRequest) {
    const refresh=async()=>{
      assertTranscript(actualRequest,req);
      if (!await middleware(requireDeviceAccess,actualRequest,res)) throw error(401,'Original Messenger credential revalidation refused.');
      assertTranscript(actualRequest,req);
      if (!isDeepStrictEqual(principal(actualRequest),actor)) throw error(409,'Original Messenger actor changed during request.');
      // The ordinary credential middleware does not verify native transport.
      // The existing original-byte JSON parser owns body/byte correspondence.
      // Never accept its nonempty parsed body with the verifier's empty fallback.
      if (!['GET','HEAD'].includes(actualRequest.method) && (!Buffer.isBuffer(actualRequest.scanAuthorityRawBody)
        || actualRequest.scanAuthorityRawBody.length===0)) {
        throw Object.assign(error(403,'Original native Messenger request bytes are required.'),
          {code:'native_request_attestation_required'});
      }
      verifyNativeDeviceRequestAttestation(actualRequest);
    };
    await refresh();
    const rows=await runReadOnlySql(`select d.id as device_pk,d.device_id,e.id as employee_id,
      d.assignment_epoch::text as assignment_epoch,u.id as user_id
      from public.devices d join public.employees e on e.id=d.assigned_employee_id
      join public.msg_users u on u.employee_id=e.id
      join public.msg_device_assignments mda on mda.device_identifier=d.device_id and mda.msg_user_id=u.id and mda.is_active
      where d.id='${actor.device_pk}'::uuid and d.device_id='${actor.device_id}'
      and d.active and e.active and u.is_active and u.role='employee'
      and e.id='${actor.employee_id}'::uuid and d.assignment_epoch='${actor.assignment_epoch}'::bigint`);
    await refresh();
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    if (!exact(row,['device_pk','device_id','employee_id','assignment_epoch','user_id'])
      || row.device_pk!==actor.device_pk || row.device_id!==actor.device_id || row.employee_id!==actor.employee_id
      || row.assignment_epoch!==actor.assignment_epoch || !UUID.test(row.user_id)) throw error(409,'Canonical original Messenger relationship is no longer current.');
    return {row,refresh};
  }
  function applicable(req) { return !req.memphisAuth && req.memphisMessagingDevice?.identity?.role!=='guest'; }
  async function act(kind,queryOnly,{captured,actor,req,res}) {
    const payload=originalPayload(captured,actor,kind);
    const {row,refresh}=await relationship(captured,res,actor,req);
    if (payload.user_id!==row.user_id) throw error(403,'Original Messenger user must match the canonical employee.');
    await refresh();
    const raw=await runRpc('app_apply_operational_command',{p_command:queryOnly?'employee_message_original_outcome':COMMANDS[kind],
      p_payload:queryOnly?{...payload,original_command:COMMANDS[kind]}:json(payload)});
    await refresh();
    const outcome=validateOutcome(raw,payload,kind,queryOnly,actor);
    return {applicable:true,outcome,result:outcome.result ?? null};
  }
  function prepare(req,res) {
    const isApplicable=applicable(req);
    // Preparation is synchronous. The router can classify the original SEND
    // thread/provider route afterward without adopting changed request data.
    const context=isApplicable?{captured:capture(req),actor:principal(req),req,res}:null;
    const action=(kind,queryOnly)=>()=>isApplicable?act(kind,queryOnly,context):Promise.resolve({applicable:false});
    return Object.freeze({applicable:isApplicable,send:action('send',false),read:action('read',false),delete:action('delete',false),
      sendOutcome:action('send',true),readOutcome:action('read',true),deleteOutcome:action('delete',true),
      async currentRelationship() {
        if (!isApplicable) return {applicable:false};
        const {row}=await relationship(context.captured,res,context.actor,req);
        return {applicable:true,relationship:freeze({...row,credential_id:context.actor.credential_id})};
      }});
  }
  const actions={prepare};
  for (const name of ['send','read','delete','sendOutcome','readOutcome','deleteOutcome','currentRelationship']) {
    // async wrapper retains the route-friendly rejected-Promise error contract.
    actions[name]=async(req,res)=>prepare(req,res)[name]();
  }
  return Object.freeze(actions);
}
