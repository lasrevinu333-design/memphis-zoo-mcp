import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {decodeNativeOriginalInventoryRequest,nativeOriginalInventoryRequestWire as originalWire} from './native-original-inventory-request.js';
import {deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';
import {recoveryInstantMicros,recoveryDeniedEffects} from './same-original-recovery-wire.js';

// Current signed READ of archived ORIGINAL request bytes. This purpose cannot
// enter the registration writer, re-sign an original or grant effect authority.
export const nativeOriginalInventoryStatusWire=Object.freeze({
 path:'/device-auth/original-inventory-ack-status',maxRequestBytes:196608,
 schema:'custodial.original-native-inventory-registration-status.v1',
 purpose:'READ_EXACT_ORIGINAL_INVENTORY_REQUEST',
});
export const nativeOriginalInventorySeparationApprovalStatusWire=Object.freeze({
 path:'/device-auth/original-inventory-separation-approval-status',maxRequestBytes:196608,
 schema:'custodial.original-native-inventory-separation-approval-status.v1',
 purpose:'READ_CURRENT_EXACT_ORIGINAL_INVENTORY_SEPARATION_APPROVAL',
});
const W=nativeOriginalInventoryStatusWire,SHA=/^[a-f0-9]{64}$/,
 UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
 captures=new WeakMap(),sha=v=>createHash('sha256').update(v).digest('hex');
const CONTEXT=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id',
 'assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'];
const GENERATION=['generation_id','device_id','device_identifier','credential_id','employee_id','assignment_epoch','principal_digest','activated_at'];
const typed=Object.getPrototypeOf(Uint8Array.prototype),buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
 length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
 capacity=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
function fail(code='native_original_inventory_status_invalid',status=403){
 throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false});
}
function plain(v){return v&&typeof v==='object'&&!types.isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
function exact(v,keys){
 if(!plain(v)||Reflect.ownKeys(v).length!==keys.length)fail();
 for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);
  if(!keys.includes(k)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();}
}
function owned(v,max){
 if(types.isProxy(v)||!Buffer.isBuffer(v)||Object.getPrototypeOf(v)!==Buffer.prototype)fail();
 try{const b=buffer.call(v),n=length.call(v),at=offset.call(v),cap=capacity.call(b);
  if(Object.getPrototypeOf(b)!==ArrayBuffer.prototype||n<1||n>max||at+n>cap)fail();
  return Buffer.from(new Uint8Array(b,at,n));
 }catch{fail();}
}
function headers(v){
 if(!plain(v))fail();const result={};
 for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);
  if(typeof k!=='string'||!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.enumerable)fail();
  Object.defineProperty(result,k,{value:d.value,enumerable:true});}
 return Object.freeze(result);
}
function method(object,key){
 if(!object||types.isProxy(object)||typeof object!=='object')fail();
 for(let p=object;p;p=Object.getPrototypeOf(p)){if(types.isProxy(p))fail();const d=Object.getOwnPropertyDescriptor(p,key);
  if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return d.value;}}
 fail();
}
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&SHA.test(a)&&SHA.test(b)
 &&timingSafeEqual(Buffer.from(a,'ascii'),Buffer.from(b,'ascii'));}
function frozen(v){if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;}
function timestamp(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||Number(v.slice(0,4))<1)fail();
 const ms=Date.parse(v);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==v)fail();return ms;
}
// ONLY the new fixed five-string approval envelope, bounded above by owned().
// An escaped 65536-byte archived original can exceed the provider parser's
// separate 64KiB contract. Do not widen that parser or the legacy policy.
function approvalEnvelope(raw){
 const keys=['schema','purpose','original_request_utf8','original_request_timestamp','original_request_attestation'];
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{fail();}
 let at=0;const result={};
 const space=()=>{while(at<text.length&&' \t\r\n'.includes(text[at]))at++;};
 function string(){
  if(text[at]!== '"')fail();const start=at++;
  while(at<text.length){const char=text[at++];if(char==='\\'){at++;continue;}
   if(char==='"'){
    let value;try{value=JSON.parse(text.slice(start,at));}catch{fail();}
    for(let n=0;n<value.length;n++){const unit=value.charCodeAt(n);
     if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++n);if(!(next>=0xdc00&&next<=0xdfff))fail();}
     else if(unit>=0xdc00&&unit<=0xdfff)fail();}
    return value;
   }
  }fail();
 }
 space();if(text[at++]!=='{')fail();
 for(let count=0;count<5;count++){
  space();const key=string();if(!keys.includes(key)||Object.hasOwn(result,key))fail();
  space();if(text[at++]!==':')fail();space();result[key]=string();space();
  if(count<4){if(text[at++]!==',')fail();}else if(text[at++]!=='}')fail();
 }
 space();if(at!==text.length)fail();return result;
}
export function decodeNativeOriginalInventoryStatus(input){return decodeForPolicy(input,W);}
export function decodeNativeOriginalInventorySeparationApprovalStatus(input){
 return decodeForPolicy(input,nativeOriginalInventorySeparationApprovalStatusWire);
}
function decodeForPolicy(input,W){
 let raw,original;
 try{
  raw=owned(input,W.maxRequestBytes);const envelope=W===nativeOriginalInventorySeparationApprovalStatusWire?
   approvalEnvelope(raw):parseNativeProviderJson(raw);
  exact(envelope,['schema','purpose','original_request_utf8','original_request_timestamp','original_request_attestation']);
  if(Object.values(envelope).some(v=>typeof v!=='string')||envelope.schema!==W.schema||envelope.purpose!==W.purpose
   ||!SHA.test(envelope.original_request_attestation))fail();
  timestamp(envelope.original_request_timestamp);
  original=Buffer.from(envelope.original_request_utf8,'utf8');
  if(original.length<1||original.length>originalWire.maxRequestBytes)fail();
  const decoded=decodeNativeOriginalInventoryRequest(original);
  if(Date.parse(decoded.intent.created_at)>timestamp(envelope.original_request_timestamp))fail();
  return frozen({envelope,original:decoded});
 }catch(error){if(error?.code?.startsWith('native_original_inventory_status_'))throw error;fail();}
 finally{raw?.fill(0);original?.fill(0);}
}
export function captureAuthenticatedNativeOriginalInventoryStatus(req,dependencies){return captureForPolicy(req,dependencies,W);}
export function captureAuthenticatedNativeOriginalInventorySeparationApprovalStatus(req,dependencies){
 return captureForPolicy(req,dependencies,nativeOriginalInventorySeparationApprovalStatusWire);
}
async function captureForPolicy(req,{env=process.env,store,runReadOnlySql,now=new Date()}={},W){
 let raw,original;const started=process.hrtime.bigint();
 try{
  if(!req||types.isProxy(req)||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path
   ||Object.hasOwn(req,'body')||typeof runReadOnlySql!=='function'||types.isProxy(runReadOnlySql))fail();
  const slot=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
  if(!slot||!Object.hasOwn(slot,'value')||!slot.enumerable)fail();
  const rawRef=slot.value,headerRef=req.headers,h=headers(headerRef),find=method(store,'findCredential');
  raw=owned(rawRef,W.maxRequestBytes);const ownedOuter=raw,decoded=decodeForPolicy(raw,W);
  original=Buffer.from(decoded.envelope.original_request_utf8,'utf8');const ownedOriginal=original,t=decoded.original.intent.original_target;
  if(h.origin!=='https://localhost'||h['x-memphis-app-edition']!=='custodial'||!/^Device \S+$/.test(h.authorization||'')
   ||!/^KIOSK_(0[2-9]|10)$/.test(h['x-device-id']||''))fail();
  const token=credentials.credentialTokenParts(h.authorization.slice(7));
  if(!token||!UUID.test(token.credentialId)||token.credentialId!==t.credential_id
   ||h['x-device-id']!==t.canonical_device_id||h['x-memphis-native-request-id']!==decoded.original.intent.intent_id)fail();
  const base=now.getTime();if(!Number.isFinite(base))fail();
  const tokenHash=credentials.tokenHash(token.secret,env),keyId=credentials.deviceCredentialSecretKeyId(env);
  const elapsed=()=>Number((process.hrtime.bigint()-started)/1000000n),clock=()=>new Date(base+elapsed());
  function current(){
   const liveSlot=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
   if(!liveSlot||!Object.hasOwn(liveSlot,'value')||liveSlot.value!==rawRef||liveSlot.enumerable!==slot.enumerable
    ||liveSlot.writable!==slot.writable||liveSlot.configurable!==slot.configurable||elapsed()>30000||req.aborted
    ||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path||req.headers!==headerRef||Object.hasOwn(req,'body')
    ||!isDeepStrictEqual(headers(headerRef),h)||method(store,'findCredential')!==find
    ||!equal(credentials.tokenHash(token.secret,env),tokenHash)||!equal(credentials.deviceCredentialSecretKeyId(env),keyId))fail();
   const bytes=owned(rawRef,W.maxRequestBytes);try{if(!bytes.equals(ownedOuter))fail();}finally{bytes.fill(0);}
  }
  async function read(sql){current();let result;try{result=await runReadOnlySql(sql);}catch{fail('native_original_inventory_status_unavailable',503);}current();return result;}
  async function principal(){
   current();const d=await resolveCanonicalDevice({runReadOnlySql:read,deviceIdentifier:h['x-device-id']});current();
   let c;try{c=await Reflect.apply(find,store,[token.credentialId]);}catch{fail('native_original_inventory_status_unavailable',503);}current();
   if(!plain(d)||!plain(c)||!plain(c.metadata_json)||d.canonical_device_pk!==t.canonical_device_pk||d.canonical_device_id!==t.canonical_device_id
    ||d.device_active!==true||d.employee_active!==false||!/^EMP[0-9]+$/i.test(d.employee_code||'')
    ||d.assigned_employee_id!==t.employee_id||!Number.isSafeInteger(Number(d.assignment_epoch))||Number(d.assignment_epoch)<1
    ||String(d.assignment_epoch)!==t.assignment_epoch||c.credential_id!==t.credential_id||c.device_id!==t.canonical_device_pk
    ||c.revoked_at||!Number.isFinite(Date.parse(c.confirmed_at))||Date.parse(c.confirmed_at)>clock().getTime()
    ||!equal(c.token_hash,tokenHash)||!equal(c.metadata_json.credential_secret_key_id,keyId)
    ||keyId!==t.original_credential_secret_key_id||!Number.isFinite(Date.parse(c.expires_at))||Date.parse(c.expires_at)<=clock().getTime())fail();
   return {d,c,identity:frozen({device:d.canonical_device_pk,identifier:d.canonical_device_id,employee:d.assigned_employee_id,
    epoch:String(d.assignment_epoch),credential:c.credential_id,hash:c.token_hash,keyId,confirmed:c.confirmed_at,expires:c.expires_at})};
  }
  const first=await principal();current();
  function verify(p){
   // Fresh signature is for THIS READ. Archived signature is verified with its
   // exact original timestamp, never renewed or used to enter the writer.
   verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:W.path,headers:h,scanAuthorityRawBody:ownedOuter,
    memphisDevice:p.d,memphisDeviceCredential:p.c},{now:clock()});
   const archivedHeaders={...h,'x-memphis-native-request-timestamp':decoded.envelope.original_request_timestamp,
    'x-memphis-native-request-attestation':decoded.envelope.original_request_attestation};
   const a=verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:originalWire.path,headers:archivedHeaders,
    scanAuthorityRawBody:ownedOriginal,memphisDevice:p.d,memphisDeviceCredential:p.c},{now:new Date(timestamp(decoded.envelope.original_request_timestamp))});
   const purpose=createHmac('sha256',token.secret).update([originalWire.purposeVersion,token.credentialId,decoded.original.body.purpose_binding_sha256].join('\n')).digest('hex');
   if(!equal(purpose,decoded.original.body.purpose_attestation))fail();return a;
  }
  verify(first);
  const contextRows=await read(`select public.custodial_v13_read_separation_context('${t.canonical_device_pk}'::uuid,'${t.credential_id}'::uuid) as context`);
  if(!Array.isArray(contextRows)||contextRows.length!==1)fail();exact(contextRows[0],['context']);
  const context=contextRows[0].context;
  exact(context,CONTEXT);
  if(!plain(context)||context.schema!=='custodial.separation-context.v1'||context.purpose!=='SEPARATION_STATUS_ONLY'
   ||context.state!=='PENDING_RECONCILIATION'||context.new_work_allowed!==false||context.phone_released!==false
   ||context.separation_id!==t.separation_id||String(context.authority_revision)!==t.separation_authority_revision
   ||context.device_id!==t.canonical_device_pk||context.canonical_device_id!==t.canonical_device_id||context.credential_id!==t.credential_id
   ||context.employee_id!==t.employee_id||!Number.isSafeInteger(context.assignment_epoch)||String(context.assignment_epoch)!==t.assignment_epoch)fail();
  const generationRows=await read(`select public.custodial_v14_read_separation_generation('${t.canonical_device_pk}'::uuid,'${t.credential_id}'::uuid,'${t.separation_id}'::uuid,'${t.original_generation_id}'::uuid,'${t.principal_digest}'::text) as original_generation`);
  if(!Array.isArray(generationRows)||generationRows.length!==1)fail();exact(generationRows[0],['original_generation']);
  const g=generationRows[0].original_generation;
  exact(g,GENERATION);
  if(!plain(g)||g.generation_id!==t.original_generation_id||g.device_id!==t.canonical_device_pk||g.device_identifier!==t.canonical_device_id
   ||g.credential_id!==t.credential_id||g.employee_id!==t.employee_id||!Number.isSafeInteger(g.assignment_epoch)
   ||String(g.assignment_epoch)!==t.assignment_epoch||g.principal_digest!==t.principal_digest
   ||recoveryInstantMicros(g.activated_at)>=recoveryInstantMicros(context.cutoff_at))fail();
  const last=await principal();current();if(!isDeepStrictEqual(first.identity,last.identity))fail();const a=verify(last);current();
  const result=frozen({schema:'custodial.native-original-inventory-status-auth-observation.v1',
   state:'CURRENT_SIGNED_READ_ONLY_NOT_TRANSACTION_OR_ACK',native_request_id:a.request_id,...recoveryDeniedEffects});
  captures.set(result,{policy:W,raw:ownedOuter,original:ownedOriginal,decoded,t,tokenHash,keyId,a,assertCurrent:current});raw=null;original=null;return result;
 }catch(error){if(error?.code?.startsWith('native_original_inventory_status_'))throw error;fail();}
 finally{raw?.fill(0);original?.fill(0);}
}
export function inspectAuthenticatedNativeOriginalInventoryStatus(capture){return inspectForPolicy(capture,W);}
export function inspectAuthenticatedNativeOriginalInventorySeparationApprovalStatus(capture){
 return inspectForPolicy(capture,nativeOriginalInventorySeparationApprovalStatusWire);
}
function inspectForPolicy(capture,W){
 const x=captures.get(capture);if(!x||x.policy!==W)fail('native_original_inventory_status_unbound');
 try{x.assertCurrent();const t=x.t,a=x.a;
  return frozen({transaction_authority:false,write_authority:false,rpc_parameters:{
   p_operation:t.operation_id,p_device:t.canonical_device_pk,p_credential:t.credential_id,p_credential_hash:x.tokenHash,
   p_credential_key_id:x.keyId,p_generation:t.original_generation_id,p_separation:t.separation_id,p_authority_revision:t.separation_authority_revision,
   p_native_request:a.request_id,p_native_request_timestamp:a.timestamp,p_native_request_body_sha256:a.body_sha256,
   p_native_attestation_digest:sha(JSON.stringify([a.version,a.credential_id,a.device_id,a.method,a.path,a.body_sha256,a.request_id,a.timestamp,a.signature])),
   p_original_request_utf8:x.original.toString('utf8')}});
 }catch(error){closeForPolicy(capture,W);throw error;}
}
export function closeAuthenticatedNativeOriginalInventoryStatus(capture){
 closeForPolicy(capture,W);
}
export function closeAuthenticatedNativeOriginalInventorySeparationApprovalStatus(capture){
 closeForPolicy(capture,nativeOriginalInventorySeparationApprovalStatusWire);
}
function closeForPolicy(capture,W){
 const x=captures.get(capture);if(!x)return;
 if(x.policy!==W)fail('native_original_inventory_status_unbound');
 captures.delete(capture);x.raw.fill(0);x.original.fill(0);
}
