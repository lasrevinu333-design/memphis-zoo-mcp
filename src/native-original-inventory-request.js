import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';
import {validateRecoveryOriginalTarget,recoveryInstantMicros,recoveryDeniedEffects} from './same-original-recovery-wire.js';

// A NEW native request purpose. Authentication at observation is not a
// transaction, complete original inventory, manager ACK approval or sender.
// Main must mount the fixed raw route and current private SQL admission; old
// preparation approvals and sixfalse projections cannot supply that admission.
export const nativeOriginalInventoryRequestWire=Object.freeze({
  path:'/device-auth/original-inventory-ack',maxRequestBytes:65536,
  schema:'custodial.original-native-inventory-ack-request.v1',purpose:'REQUEST_EXACT_ORIGINAL_INVENTORY_ACK',
  purposeVersion:'custodial.native-original-inventory-ack-purpose.v1',
});
const W=nativeOriginalInventoryRequestWire,SHA=/^[a-f0-9]{64}$/,
  UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BODY=['schema','purpose','original_intent_utf8','original_intent_disk_sha256','original_intent_document_sha256',
  'original_preparation_native_request_id','original_preparation_request_body_sha256','original_preparation_http_attestation',
  'purpose_binding_sha256','purpose_attestation'];
const INTENT=['schema','purpose','intent_id','original_target','native_held_stamp','browser_frame_sha256',
  'browser_part_set_sha256','created_at',...Object.keys(recoveryDeniedEffects)];
const CONTEXT=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id',
  'assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'];
const GENERATION=['generation_id','device_id','device_identifier','credential_id','employee_id','assignment_epoch','principal_digest','activated_at'];
const captures=new WeakMap(),hash=value=>createHash('sha256').update(value).digest('hex');
const typed=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
  getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
  getCapacity=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
function fail(code='native_original_inventory_request_invalid',status=403){
  throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false});
}
function plain(value){return value&&typeof value==='object'&&!types.isProxy(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function exact(value,keys){
  if(!plain(value)||Reflect.ownKeys(value).length!==keys.length)fail();
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!keys.includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();
  }
}
function owned(input){
  if(types.isProxy(input)||!Buffer.isBuffer(input)||Object.getPrototypeOf(input)!==Buffer.prototype)fail();
  try{
    const backing=getBuffer.call(input),length=getLength.call(input),offset=getOffset.call(input),capacity=getCapacity.call(backing);
    if(Object.getPrototypeOf(backing)!==ArrayBuffer.prototype||length<1||length>W.maxRequestBytes||offset+length>capacity)fail();
    return Buffer.from(new Uint8Array(backing,offset,length));
  }catch{fail();}
}
function frozen(value){if(value&&typeof value==='object'){for(const v of Object.values(value))frozen(v);Object.freeze(value);}return value;}
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&SHA.test(a)&&SHA.test(b)
  &&timingSafeEqual(Buffer.from(a,'ascii'),Buffer.from(b,'ascii'));}
function millis(text){
  if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
    ||Number(text.slice(0,4))<1)fail();
  const value=Date.parse(text);if(!Number.isFinite(value)||new Date(value).toISOString()!==text)fail();return value;
}
function strings(value){
  if(!plain(value))fail();const result={};
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.enumerable)fail();
    Object.defineProperty(result,key,{value:d.value,enumerable:true});
  }return Object.freeze(result);
}
function callable(object,key){
  if(!object||typeof object!=='object'||types.isProxy(object))fail('native_original_inventory_auth_unavailable',503);
  for(let p=object;p;p=Object.getPrototypeOf(p)){
    if(types.isProxy(p))fail('native_original_inventory_auth_unavailable',503);
    const d=Object.getOwnPropertyDescriptor(p,key);
    if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail('native_original_inventory_auth_unavailable',503);return d.value;}
  }fail('native_original_inventory_auth_unavailable',503);
}
export function decodeNativeOriginalInventoryRequest(input){
  let raw,intentBytes;
  try{
    raw=owned(input);const body=parseNativeProviderJson(raw);exact(body,BODY);
    if(BODY.some(key=>typeof body[key]!=='string')||body.schema!==W.schema||body.purpose!==W.purpose
      ||!UUID.test(body.original_preparation_native_request_id))fail();
    for(const key of ['original_intent_disk_sha256','original_intent_document_sha256','original_preparation_request_body_sha256',
      'original_preparation_http_attestation','purpose_binding_sha256','purpose_attestation'])if(!SHA.test(body[key]))fail();
    intentBytes=Buffer.from(body.original_intent_utf8,'utf8');
    if(intentBytes.length<1||intentBytes.length>16384||!equal(hash(intentBytes),body.original_intent_document_sha256))fail();
    const intent=parseNativeProviderJson(intentBytes);exact(intent,INTENT);
    if(intent.schema!=='custodial.native-original-inventory-ack-intent.v1'
      ||intent.purpose!=='PREPARE_EXACT_ORIGINAL_INVENTORY_ACK'||!UUID.test(intent.intent_id||''))fail();
    const target=validateRecoveryOriginalTarget(intent.original_target);
    if(typeof intent.native_held_stamp!=='string'||!/^DURABLE_HELD:[1-9][0-9]{0,18}$/.test(intent.native_held_stamp)
      ||BigInt(intent.native_held_stamp.slice(13))>9223372036854775807n
      ||!SHA.test(intent.browser_frame_sha256)||!SHA.test(intent.browser_part_set_sha256))fail();
    millis(intent.created_at);
    for(const key of Object.keys(recoveryDeniedEffects))if(intent[key]!==false)fail();
    const binding=hash([W.purposeVersion,body.original_intent_disk_sha256,body.original_intent_document_sha256,
      body.original_preparation_native_request_id,body.original_preparation_request_body_sha256,
      body.original_preparation_http_attestation].join('\n'));
    if(!equal(binding,body.purpose_binding_sha256))fail();
    return frozen({body,intent:{...intent,original_target:target}});
  }catch(error){if(error?.code==='native_original_inventory_request_invalid')throw error;fail();}
  finally{raw?.fill(0);intentBytes?.fill(0);}
}

/** Fixed private observation intake. The ordinary active-employee auth route
 * cannot substitute for inactive original owner + immutable separation. The
 * branded capture below is still NOT the current transaction or an ACK. */
export async function captureAuthenticatedNativeOriginalInventoryRequest(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
  let raw;const started=process.hrtime.bigint();
  try{
    if(!req||types.isProxy(req)||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path
      ||Object.hasOwn(req,'body')||typeof runReadOnlySql!=='function'||types.isProxy(runReadOnlySql))fail();
    const rawDescriptor=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
    if(!rawDescriptor||!Object.hasOwn(rawDescriptor,'value')||!rawDescriptor.enumerable)fail();
    const headersRef=req.headers,rawRef=rawDescriptor.value,headers=strings(headersRef),find=callable(store,'findCredential');
    raw=owned(rawRef);const originalRaw=raw;
    const decoded=decodeNativeOriginalInventoryRequest(originalRaw),target=decoded.intent.original_target;
    if(headers.origin!=='https://localhost'||headers['x-memphis-app-edition']!=='custodial'
      ||!/^Device \S+$/.test(headers.authorization||'')||!/^KIOSK_(0[2-9]|10)$/.test(headers['x-device-id']||''))fail();
    const token=credentials.credentialTokenParts(headers.authorization.slice(7));
    if(!token||!UUID.test(token.credentialId)||token.credentialId!==target.credential_id
      ||headers['x-device-id']!==target.canonical_device_id||headers['x-memphis-native-request-id']!==decoded.intent.intent_id)fail();
    const base=now.getTime();if(!Number.isFinite(base))fail();
    const credentialHash=credentials.tokenHash(token.secret,env),keyId=credentials.deviceCredentialSecretKeyId(env);
    const elapsed=()=>Number((process.hrtime.bigint()-started)/1000000n);
    const clock=()=>new Date(base+elapsed());
    function current(){
      const liveDescriptor=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
      if(!liveDescriptor||!Object.hasOwn(liveDescriptor,'value')||liveDescriptor.value!==rawRef
        ||liveDescriptor.enumerable!==rawDescriptor.enumerable||liveDescriptor.writable!==rawDescriptor.writable
        ||liveDescriptor.configurable!==rawDescriptor.configurable)fail();
      if(elapsed()>30000||req.aborted||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path
        ||req.headers!==headersRef||Object.hasOwn(req,'body')
        ||callable(store,'findCredential')!==find||!isDeepStrictEqual(strings(headersRef),headers)
        ||!equal(credentials.deviceCredentialSecretKeyId(env),keyId)||!equal(credentials.tokenHash(token.secret,env),credentialHash))fail();
      const live=owned(rawRef);try{if(!live.equals(originalRaw))fail();}finally{live.fill(0);}
    }
    async function read(sql){current();let rows;
      try{rows=await runReadOnlySql(sql);}catch{fail('native_original_inventory_auth_unavailable',503);}
      current();return rows;
    }
    async function one(sql,key){const rows=await read(sql);
      if(!Array.isArray(rows)||rows.length!==1)fail();exact(rows[0],[key]);
      const value=rows[0][key];if(!plain(value))fail();return frozen(structuredClone(value));
    }
    async function principal(){
      current();const device=await resolveCanonicalDevice({runReadOnlySql:read,deviceIdentifier:headers['x-device-id']});current();
      let row;try{row=await Reflect.apply(find,store,[token.credentialId]);}catch{fail('native_original_inventory_auth_unavailable',503);}
      current();
      if(!plain(device)||!plain(row)||types.isProxy(row.metadata_json))fail();
      const epoch=Number(device.assignment_epoch);
      if(device.canonical_device_pk!==target.canonical_device_pk||device.canonical_device_id!==target.canonical_device_id
        ||device.device_active!==true||device.employee_active!==false||!/^EMP[0-9]+$/i.test(device.employee_code||'')
        ||device.assigned_employee_id!==target.employee_id||!Number.isSafeInteger(epoch)||epoch<1||String(epoch)!==target.assignment_epoch
        ||row.credential_id!==token.credentialId||row.device_id!==device.canonical_device_pk||row.revoked_at
        ||!row.confirmed_at||!Number.isFinite(Date.parse(row.confirmed_at))||Date.parse(row.confirmed_at)>clock().getTime()
        ||!equal(row.token_hash,credentialHash)||!plain(row.metadata_json)
        ||!equal(row.metadata_json.credential_secret_key_id,keyId)||keyId!==target.original_credential_secret_key_id
        ||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=clock().getTime())fail();
      return {device,row,identity:frozen({device:device.canonical_device_pk,identifier:device.canonical_device_id,
        employee:device.assigned_employee_id,epoch,credential:row.credential_id,hash:row.token_hash,keyId,
        confirmed:row.confirmed_at,expires:row.expires_at})};
    }
    const first=await principal();current();
    verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:W.path,headers,scanAuthorityRawBody:raw,
      memphisDevice:first.device,memphisDeviceCredential:first.row},{now:clock()});
    const purpose=createHmac('sha256',token.secret).update([W.purposeVersion,token.credentialId,decoded.body.purpose_binding_sha256].join('\n')).digest('hex');
    if(!equal(purpose,decoded.body.purpose_attestation))fail();
    const context=await one(`select public.custodial_v13_read_separation_context('${target.canonical_device_pk}'::uuid,'${target.credential_id}'::uuid) as context`,'context');
    exact(context,CONTEXT);
    if(context.schema!=='custodial.separation-context.v1'||context.purpose!=='SEPARATION_STATUS_ONLY'
      ||context.state!=='PENDING_RECONCILIATION'||context.new_work_allowed!==false||context.phone_released!==false
      ||context.separation_id!==target.separation_id||String(context.authority_revision)!==target.separation_authority_revision
      ||context.device_id!==target.canonical_device_pk||context.canonical_device_id!==target.canonical_device_id
      ||context.credential_id!==target.credential_id||context.employee_id!==target.employee_id
      ||!Number.isSafeInteger(context.assignment_epoch)||String(context.assignment_epoch)!==target.assignment_epoch)fail();
    const generation=await one(`select public.custodial_v14_read_separation_generation('${target.canonical_device_pk}'::uuid,'${target.credential_id}'::uuid,'${target.separation_id}'::uuid,'${target.original_generation_id}'::uuid,'${target.principal_digest}'::text) as original_generation`,'original_generation');
    exact(generation,GENERATION);
    if(generation.generation_id!==target.original_generation_id||generation.device_id!==target.canonical_device_pk
      ||generation.device_identifier!==target.canonical_device_id||generation.credential_id!==target.credential_id
      ||generation.employee_id!==target.employee_id||!Number.isSafeInteger(generation.assignment_epoch)
      ||String(generation.assignment_epoch)!==target.assignment_epoch||generation.principal_digest!==target.principal_digest
      ||recoveryInstantMicros(generation.activated_at)>=recoveryInstantMicros(context.cutoff_at))fail();
    const last=await principal();current();if(!isDeepStrictEqual(first.identity,last.identity))fail();
    const attestation=verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:W.path,headers,scanAuthorityRawBody:raw,
      memphisDevice:last.device,memphisDeviceCredential:last.row},{now:clock()});
    if(millis(decoded.intent.created_at)>millis(attestation.timestamp))fail();
    const result=frozen({schema:'custodial.native-original-inventory-request-auth-observation.v1',
      state:'CURRENT_AUTH_OBSERVED_NOT_TRANSACTION_OR_ACK',native_request_id:decoded.intent.intent_id,
      request_body_sha256:hash(raw),current_transaction_admission:false,...recoveryDeniedEffects});
    // Transfer the SAME owned bytes into this private capture. Its currentness
    // closure must not refer to a scratch buffer cleared by the finally below.
    // Only close/retirement may wipe this original after the caller handoff.
    captures.set(result,{raw:originalRaw,decoded,target,credentialHash,keyId,attestation,context,generation,
      identity:last.identity,assertCurrent:current});
    raw=null;
    return result;
  }catch(error){if(error?.code?.startsWith('native_original_inventory_'))throw error;fail();}
  finally{raw?.fill(0);}
}

export function inspectAuthenticatedNativeOriginalInventoryRequest(capture){
  const entry=captures.get(capture);if(!entry)fail('native_original_inventory_capture_unbound');
  try{
    // Input ownership is still a live prerequisite at the transaction handoff.
    // This inspector supplies parameters, not a transaction/custody capability.
    entry.assertCurrent();const a=entry.attestation,t=entry.target;
    return frozen({capture,transaction_authority:false,original_target:t,
      rpc_parameters:{p_operation:t.operation_id,p_device:t.canonical_device_pk,p_credential:t.credential_id,
        p_credential_hash:entry.credentialHash,p_credential_key_id:entry.keyId,p_generation:t.original_generation_id,
        p_separation:t.separation_id,p_authority_revision:t.separation_authority_revision,
        p_native_request:a.request_id,p_native_request_timestamp:a.timestamp,p_native_request_body_sha256:a.body_sha256,
        p_native_attestation_digest:hash(JSON.stringify([a.version,a.credential_id,a.device_id,a.method,a.path,a.body_sha256,a.request_id,a.timestamp,a.signature])),
        p_original_request_utf8:entry.raw.toString('utf8')}});
  }catch(error){closeAuthenticatedNativeOriginalInventoryRequest(capture);throw error;}
}
export function closeAuthenticatedNativeOriginalInventoryRequest(capture){
  const entry=captures.get(capture);if(!entry)return;captures.delete(capture);entry.raw.fill(0);
}
