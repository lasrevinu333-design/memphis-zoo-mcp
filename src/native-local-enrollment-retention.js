import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';

export const localEnrollmentRetentionWire=Object.freeze({path:'/device-auth/local-enrollment-retention',
 schema:'custodial.native-local-enrollment-retention.v1',purpose:'custodial.native-local-enrollment-retention-purpose.v1',
 rpc:'custodial_record_local_enrollment_retention_v1',maxRequestBytes:16384});
const W=localEnrollmentRetentionWire;
export const localEnrollmentRetentionFields=Object.freeze(['schema','realm_id','previous_realm','inventory_native_request_id','approval_id','operation_id',
 'credential_id','manifest_sha256','local_finalization_intent_document_sha256','local_finalization_intent_disk_sha256',
 'original_native_values_sha256','original_browser_frame_sha256','original_browser_part_set_sha256']);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code='local_enrollment_retention_invalid',status=403)=>{throw Object.assign(new Error(code),{code,status});};
function plain(v){return v&&typeof v==='object'&&!types.isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
function exact(v,keys){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length)fail();for(const k of Reflect.ownKeys(v)){
 const d=Object.getOwnPropertyDescriptor(v,k);if(!keys.includes(k)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();}}
function same(a,b){return typeof a==='string'&&typeof b==='string'&&SHA.test(a)&&SHA.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
const typed=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
 getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
 getCapacity=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
function rawCopy(raw){
 if(types.isProxy(raw)||!Buffer.isBuffer(raw)||Object.getPrototypeOf(raw)!==Buffer.prototype)fail();
 try{const backing=getBuffer.call(raw),length=getLength.call(raw),offset=getOffset.call(raw),capacity=getCapacity.call(backing);
  if(Object.getPrototypeOf(backing)!==ArrayBuffer.prototype||length<1||length>W.maxRequestBytes||offset+length>capacity)fail();
  return Buffer.from(new Uint8Array(backing,offset,length));}catch{fail();}
}
function method(v,key){if(!v||types.isProxy(v))fail();for(let p=v;p;p=Object.getPrototypeOf(p)){
 if(types.isProxy(p))fail();const d=Object.getOwnPropertyDescriptor(p,key);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return d.value;}}fail();}
function headers(v){if(!plain(v))fail();const out={};for(const k of Reflect.ownKeys(v)){
 const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')fail();
 Object.defineProperty(out,k,{value:d.value,enumerable:true});}return out;}
export function decodeLocalEnrollmentRetention(raw){
 let owned;try{
  owned=rawCopy(raw);const body=parseNativeProviderJson(owned);exact(body,[...localEnrollmentRetentionFields,'purpose_binding_sha256','purpose_attestation']);
  if(Object.values(body).some(v=>typeof v!=='string')||body.schema!==W.schema)fail();
  for(const key of ['realm_id','inventory_native_request_id','approval_id','operation_id','credential_id'])if(!UUID.test(body[key]))fail();
  if(body.previous_realm!=='legacy'&&!UUID.test(body.previous_realm)||body.previous_realm===body.realm_id)fail();
  for(const key of Object.keys(body))if((key.endsWith('sha256')||key==='purpose_attestation')&&!SHA.test(body[key]))fail();
  const binding=hash(localEnrollmentRetentionFields.map(k=>body[k]).join('\n'));
  if(!same(binding,body.purpose_binding_sha256))fail();return Object.freeze(body);
 }catch(e){if(e?.code?.startsWith('local_enrollment_'))throw e;fail();}finally{owned?.fill(0);}
}

/** Evidence of an already spent, local-only preservation operation. This
 * purpose permits no active-device access, Start/Finish, recovery replay,
 * assignment, key removal or work acceptance. Ordinary credential expiry and
 * revocation checks stay in the ordinary authenticator. A historical secret
 * proves only this exact retained fact; revoked credentials remain refused.
 * Owning SQL still joins the original approved inventory under transaction.
 */
export async function captureLocalEnrollmentRetention(req,{env,store,runReadOnlySql,now=new Date()}={}){
 let raw;try{
  if(!req||types.isProxy(req)||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path
   ||Object.hasOwn(req,'body')||typeof runReadOnlySql!=='function'||types.isProxy(runReadOnlySql))fail();
  const slot=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');if(!slot||!Object.hasOwn(slot,'value'))fail();
  const originalRaw=slot.value,originalHeaders=req.headers,h=headers(originalHeaders);raw=rawCopy(originalRaw);
  const body=decodeLocalEnrollmentRetention(raw),find=method(store,'findCredential'),base=Date.prototype.getTime.call(now),start=process.hrtime.bigint();
  if(!Number.isFinite(base)||h.origin!=='https://localhost'||h['x-memphis-app-edition']!=='custodial'
   ||!/^Device \S+$/.test(h.authorization||'')||h['x-memphis-native-request-id']!==body.realm_id)fail();
  const token=credentials.credentialTokenParts(h.authorization.slice(7));
  if(!token||token.credentialId!==body.credential_id)fail();
  const credentialHash=credentials.tokenHash(token.secret,env),keyId=credentials.deviceCredentialSecretKeyId(env);
  const marker={realm_id:body.realm_id,operation_id:body.operation_id,report_sha256:hash(raw),inventory_native_request_id:body.inventory_native_request_id};
  const clock=()=>new Date(base+Number((process.hrtime.bigint()-start)/1000000n));
  function current(){
   const live=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');
   if(!live||!Object.hasOwn(live,'value')||live.value!==originalRaw||req.headers!==originalHeaders
    ||req.method!=='POST'||req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path||req.aborted
    ||Object.hasOwn(req,'body')||Number((process.hrtime.bigint()-start)/1000000n)>30000
    ||!isDeepStrictEqual(headers(req.headers),h)||method(store,'findCredential')!==find
    ||!same(credentials.tokenHash(token.secret,env),credentialHash)||!same(credentials.deviceCredentialSecretKeyId(env),keyId))fail();
   const copy=rawCopy(originalRaw);try{if(!copy.equals(raw))fail();}finally{copy.fill(0);}
  }
  async function read(sql){current();const rows=await runReadOnlySql(sql);current();return rows;}
  async function principal(){
   current();const device=await resolveCanonicalDevice({runReadOnlySql:read,deviceIdentifier:h['x-device-id']});current();
   const row=await Reflect.apply(find,store,[token.credentialId]);current();
   if(!plain(device)||!plain(row)||!plain(row.metadata_json)||row.credential_id!==token.credentialId
    ||row.device_id!==device.canonical_device_pk||h['x-device-id']!==device.canonical_device_id
    ||row.revoked_at||!Number.isFinite(Date.parse(row.expires_at))||!Number.isFinite(Date.parse(row.confirmed_at))||Date.parse(row.confirmed_at)>clock().getTime()
    ||!same(row.token_hash,credentialHash)||!same(row.metadata_json.credential_secret_key_id,keyId))fail();
   const metadata=structuredClone(row.metadata_json);
   if(Object.hasOwn(metadata,'retained_original_enrollment')){
    if(!isDeepStrictEqual(metadata.retained_original_enrollment,marker))fail('local_enrollment_retention_conflict',409);
    delete metadata.retained_original_enrollment;
   }
   const proof=verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:W.path,headers:h,scanAuthorityRawBody:raw,
    memphisDevice:device,memphisDeviceCredential:row},{now:clock()});
   const signature=createHmac('sha256',token.secret).update([W.purpose,token.credentialId,body.purpose_binding_sha256].join('\n')).digest('hex');
   if(!same(signature,body.purpose_attestation))fail();
   return {physicalDevice:device.canonical_device_pk,physicalIdentifier:device.canonical_device_id,
    credential:row.credential_id,hash:row.token_hash,confirmed:row.confirmed_at,expires:row.expires_at,
    keyId,metadata,proof};
  }
  const first=await principal();
  async function revalidate(){const last=await principal();const {proof:a,...initial}=first,{proof:b,...terminal}=last;
   if(!isDeepStrictEqual(initial,terminal)||!isDeepStrictEqual(a,b))fail();current();}
  let closed=false;
  const parameters=Object.freeze({p_credential:body.credential_id,p_credential_hash:credentialHash,p_credential_key_id:keyId,
   p_original_utf8:raw.toString('utf8')});
  const result={body,parameters,deviceIdentifier:first.physicalIdentifier,async revalidate(){if(closed)fail();return revalidate();},close(){closed=true;raw?.fill(0);raw=null;}};
  // Transfer bytes only into this closed handler-owned continuation, never a
  // public capture/issuer factory or a client-declared permission flag.
  return result;
 }catch(e){raw?.fill(0);if(e?.code?.startsWith('local_enrollment_'))throw e;fail();}
}

function retentionReceipt(result,capture){
 if(!plain(result)||result.error){const code=result?.error?.code;fail('local_enrollment_retention_unknown',code==='42501'?403:['23505','40001'].includes(code)?409:503);}
 let bytes;try{
  const text=typeof result.data==='string'?result.data:JSON.stringify(result.data);
  if(typeof text!=='string'||Buffer.byteLength(text)>8192)fail('local_enrollment_retention_unknown',503);
  bytes=Buffer.from(text);const r=parseNativeProviderJson(bytes);
  exact(r,['schema','realm_id','operation_id','inventory_native_request_id','credential_id','employee_id','canonical_device_id',
   'report_sha256','recorded_at','work_accepted','key_removal','phone_released']);
  const body=capture.body;
  if(r.schema!=='custodial.local-enrollment-retention-receipt.v1'||r.realm_id!==body.realm_id||r.operation_id!==body.operation_id
   ||r.inventory_native_request_id!==body.inventory_native_request_id||r.credential_id!==body.credential_id
   ||!UUID.test(r.employee_id)||r.canonical_device_id!==capture.deviceIdentifier
   ||!same(r.report_sha256,hash(capture.parameters.p_original_utf8))||!Number.isFinite(Date.parse(r.recorded_at))
   ||r.work_accepted!==false||r.key_removal!==false||r.phone_released!==false)fail('local_enrollment_retention_unknown',503);
  return Object.freeze(r);
 }catch(e){if(e?.code?.startsWith('local_enrollment_'))throw e;fail('local_enrollment_retention_unknown',503);}
 finally{bytes?.fill(0);}
}
export function installLocalEnrollmentRetentionRoute(app,input){
 if(!plain(input)||Reflect.ownKeys(input).some(k=>!['env','store','runReadOnlySql','db','now'].includes(k))
  ||['env','store','runReadOnlySql','db'].some(k=>!Object.hasOwn(input,k)))fail('local_enrollment_retention_dependency_missing',503);
 const d={};for(const k of Reflect.ownKeys(input)){const v=Object.getOwnPropertyDescriptor(input,k);if(!v||!Object.hasOwn(v,'value')||!v.enumerable)fail();d[k]=v.value;}
 if(typeof d.runReadOnlySql!=='function'||types.isProxy(d.runReadOnlySql)||d.now!==undefined&&(typeof d.now!=='function'||types.isProxy(d.now)))fail();
 const rpc=method(d.db,'rpc'),use=method(app,'use'),post=method(app,'post');method(d.store,'findCredential');
 const send=(res,status,body)=>{if(!res.destroyed&&!res.headersSent&&!res.writableEnded)res.status(status).json(body);};
 const unknown=(res,status=503,code='local_enrollment_retention_unknown')=>send(res,status,{ok:false,code,outcome:'UNKNOWN',
  work_accepted:false,key_removal:false,phone_released:false});
 Reflect.apply(use,app,[(req,res,next)=>{
  let decoded=req.path;try{decoded=decodeURIComponent(decoded);}catch{}
  if(![req.path,decoded].some(p=>typeof p==='string'&&(p.toLowerCase()===W.path||p.toLowerCase().startsWith(W.path+'/'))))return next();
  res.setHeader('Cache-Control','private, no-store');
  if(req.originalUrl!==W.path||req.url!==W.path||req.path!==W.path)return unknown(res,400,'local_enrollment_retention_exact_path_required');
  if(req.method!=='POST')return unknown(res,405,'local_enrollment_retention_method_invalid');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')
   ||req.headers['content-encoding']!==undefined&&req.headers['content-encoding']!=='identity')return unknown(res,415,'local_enrollment_retention_content_type_invalid');
  const size=req.headers['content-length'];
  if(size!==undefined&&(!/^[0-9]+$/.test(size)||Number(size)<1))return unknown(res,400,'local_enrollment_retention_body_invalid');
  if(size!==undefined&&Number(size)>W.maxRequestBytes)return unknown(res,413,'local_enrollment_retention_body_too_large');next();
 }]);
 Reflect.apply(post,app,[W.path,(req,res)=>{
  if(req.readableEnded||Object.hasOwn(req,'body')||Object.hasOwn(req,'scanAuthorityRawBody'))return unknown(res,400,'local_enrollment_retention_parser_order_invalid');
  let ended=false,active=false,withdrawn=false,settled=false,size=0,raw=null,capture=null,timer;const parts=[];
  const live=()=>!withdrawn&&!req.aborted&&!res.destroyed&&!res.writableEnded;
  const stop=()=>{req.off('data',onData);req.off('end',onEnd);};
  function cleanup(){clearTimeout(timer);stop();req.off('aborted',onAbort);req.off('close',onClose);req.off('error',onAbort);res.off('close',onResponseClose);
   for(const p of parts)p.fill(0);parts.length=0;capture?.close();capture=null;
   const slot=Object.getOwnPropertyDescriptor(req,'scanAuthorityRawBody');if(slot&&Object.hasOwn(slot,'value')&&slot.value===raw&&slot.configurable)delete req.scanAuthorityRawBody;
   raw?.fill(0);raw=null;}
  function withdraw(status=503,code='local_enrollment_retention_unknown'){
   if(settled)return;withdrawn=true;stop();unknown(res,status,code);if(!active){settled=true;cleanup();}}
  function onAbort(){withdraw(400,'local_enrollment_retention_receive_aborted');}
  function onClose(){if(!ended)onAbort();}
  function onResponseClose(){if(!settled)withdraw();}
  function onData(chunk){if(ended||withdrawn)return;
   if(types.isProxy(chunk)||!Buffer.isBuffer(chunk)||Object.getPrototypeOf(chunk)!==Buffer.prototype)return withdraw(400,'local_enrollment_retention_body_invalid');
   size+=chunk.length;if(size>W.maxRequestBytes)return withdraw(413,'local_enrollment_retention_body_too_large');parts.push(Buffer.from(chunk));}
  async function onEnd(){if(ended||withdrawn||settled)return;ended=true;active=true;stop();
   try{
    raw=Buffer.concat(parts);for(const p of parts)p.fill(0);parts.length=0;
    const length=req.headers['content-length'];if(!raw.length||length!==undefined&&Number(length)!==raw.length)fail('local_enrollment_retention_body_invalid',400);
    Object.defineProperty(req,'scanAuthorityRawBody',{value:raw,writable:true,enumerable:true,configurable:true});if(!live())fail();
    capture=await captureLocalEnrollmentRetention(req,{env:d.env,store:d.store,runReadOnlySql:d.runReadOnlySql,now:d.now?d.now():new Date()});
    if(!live()||method(d.db,'rpc')!==rpc)fail();await capture.revalidate();if(!live())fail();
    // Exact report identity/body owns an idempotent SQL receipt. No cleaning
    // payload is uploaded, accepted, reattributed or deleted by this operation.
    const result=await Reflect.apply(rpc,d.db,[W.rpc,capture.parameters]);
    if(!live()||method(d.db,'rpc')!==rpc)fail();await capture.revalidate();
    const receipt=retentionReceipt(result,capture);if(!live())fail();settled=true;send(res,200,{ok:true,data:receipt});
   }catch(e){settled=true;unknown(res,[400,403,409].includes(e?.status)?e.status:503,
    typeof e?.code==='string'&&e.code.startsWith('local_enrollment_')?e.code:'local_enrollment_retention_unknown');}
   finally{active=false;cleanup();}
  }
  timer=setTimeout(()=>withdraw(408,'local_enrollment_retention_receive_deadline'),30000);timer.unref?.();
  req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAbort);req.once('close',onClose);req.once('error',onAbort);res.once('close',onResponseClose);
 }]);return Object.freeze({path:W.path,maxRequestBytes:W.maxRequestBytes,receiveDeadlineMs:30000});
}
