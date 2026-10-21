import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';
import {validateRecoveryOriginalTarget,recoveryInstantMicros,recoveryDeniedEffects} from './same-original-recovery-wire.js';

// Fixed native manifest CHUNK preservation only, never ACK or finalization.
// The complete exact manifest must be assembled and source-bound under SQL
// before a manager can review it. Auth observation is not that transaction.
export const nativeOriginalInventoryManifestChunkWire=Object.freeze({
 path:'/device-auth/original-inventory-manifest-chunk',maxRequestBytes:65536,
 schema:'custodial.original-native-inventory-manifest-chunk.v1',
 purpose:'RETAIN_EXACT_ORIGINAL_INVENTORY_MANIFEST_CHUNK',
 purposeVersion:'custodial.native-original-inventory-manifest-chunk-purpose.v1',
 chunkBytes:32768,maxManifestBytes:16777216,maxChunks:512,
});
const W=nativeOriginalInventoryManifestChunkWire,SHA=/^[a-f0-9]{64}$/,
 UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BODY=['schema','purpose','inventory_native_request_id','registration_request_body_sha256','intent_document_sha256',
 'intent_disk_sha256','original_target','manifest_sha256','manifest_byte_count','manifest_chunk_count','manifest_chunk_index',
 'chunk_base64','chunk_sha256','purpose_binding_sha256','purpose_attestation'];
const CONTEXT=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id',
  'assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'];
const GENERATION=['generation_id','device_id','device_identifier','credential_id','employee_id','assignment_epoch','principal_digest','activated_at'];
const captures=new WeakMap(),hash=value=>createHash('sha256').update(value).digest('hex');
const typed=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
  getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
  getCapacity=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
function fail(code='native_original_inventory_manifest_chunk_invalid',status=403){
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
export function decodeNativeOriginalInventoryManifestChunk(input){
 let raw,chunk;
 try{
  raw=owned(input);const body=parseNativeProviderJson(raw);exact(body,BODY);
  if(body.schema!==W.schema||body.purpose!==W.purpose||!UUID.test(body.inventory_native_request_id||''))fail();
  for(const key of BODY.filter(k=>k!=='original_target'))if(typeof body[key]!=='string')fail();
  for(const key of ['registration_request_body_sha256','intent_document_sha256','intent_disk_sha256',
   'manifest_sha256','chunk_sha256','purpose_binding_sha256','purpose_attestation'])if(!SHA.test(body[key]))fail();
  const target=validateRecoveryOriginalTarget(body.original_target);
  function count(key,max,zero=false){const value=body[key];
   if(!(zero?/^(?:0|[1-9][0-9]*)$/:/^[1-9][0-9]*$/).test(value)||value.length>8)fail();
   const n=Number(value);if(!Number.isSafeInteger(n)||n>max)fail();return n;}
  const bytes=count('manifest_byte_count',W.maxManifestBytes),parts=count('manifest_chunk_count',W.maxChunks),
   index=count('manifest_chunk_index',W.maxChunks-1,true);
  if(parts!==Math.ceil(bytes/W.chunkBytes)||index>=parts
   ||body.chunk_base64.length>4*Math.ceil(W.chunkBytes/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.chunk_base64))fail();
  chunk=Buffer.from(body.chunk_base64,'base64');
  if(chunk.toString('base64')!==body.chunk_base64||chunk.length!==Math.min(W.chunkBytes,bytes-index*W.chunkBytes)
   ||!equal(hash(chunk),body.chunk_sha256))fail();
  const binding=hash([W.purposeVersion,body.inventory_native_request_id,body.registration_request_body_sha256,
   body.intent_document_sha256,body.intent_disk_sha256,body.manifest_sha256,body.manifest_byte_count,
   body.manifest_chunk_count,body.manifest_chunk_index,body.chunk_sha256].join('\n'));
  if(!equal(binding,body.purpose_binding_sha256))fail();
  return frozen({body,target});
 }catch(error){if(error?.code?.startsWith('native_original_inventory_manifest_chunk_'))throw error;fail();}
 finally{raw?.fill(0);chunk?.fill(0);}
}

/** Fixed private observation intake. The ordinary active-employee auth route
 * cannot substitute for inactive original owner + immutable separation. The
 * branded capture below is still NOT the current transaction or an ACK. */
export async function captureAuthenticatedNativeOriginalInventoryManifestChunk(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
  let raw;const started=process.hrtime.bigint();
  try{
    if(!req||types.isProxy(req)||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path
      ||Object.hasOwn(req,'body')||typeof runReadOnlySql!=='function'||types.isProxy(runReadOnlySql))fail();
    const rawDescriptor=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
    if(!rawDescriptor||!Object.hasOwn(rawDescriptor,'value')||!rawDescriptor.enumerable)fail();
    const headersRef=req.headers,rawRef=rawDescriptor.value,headers=strings(headersRef),find=callable(store,'findCredential');
    raw=owned(rawRef);const originalRaw=raw;
    const decoded=decodeNativeOriginalInventoryManifestChunk(originalRaw),target=decoded.target;
    if(headers.origin!=='https://localhost'||headers['x-memphis-app-edition']!=='custodial'
      ||!/^Device \S+$/.test(headers.authorization||'')||!/^KIOSK_(0[2-9]|10)$/.test(headers['x-device-id']||''))fail();
    const token=credentials.credentialTokenParts(headers.authorization.slice(7));
    if(!token||!UUID.test(token.credentialId)||token.credentialId!==target.credential_id
      ||headers['x-device-id']!==target.canonical_device_id||!UUID.test(headers['x-memphis-native-request-id']||'')||headers['x-memphis-native-request-id']===decoded.body.inventory_native_request_id)fail();
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
    const result=frozen({schema:'custodial.native-original-inventory-manifest-chunk-auth-observation.v1',
      state:'CURRENT_AUTH_OBSERVED_NOT_TRANSACTION_OR_ACK',native_request_id:attestation.request_id,
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

export function inspectAuthenticatedNativeOriginalInventoryManifestChunk(capture){
  const entry=captures.get(capture);if(!entry)fail('native_original_inventory_manifest_chunk_capture_unbound');
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
  }catch(error){closeAuthenticatedNativeOriginalInventoryManifestChunk(capture);throw error;}
}
export function closeAuthenticatedNativeOriginalInventoryManifestChunk(capture){
  const entry=captures.get(capture);if(!entry)return;captures.delete(capture);entry.raw.fill(0);
}
