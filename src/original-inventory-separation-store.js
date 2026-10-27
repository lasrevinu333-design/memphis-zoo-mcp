import {isDeepStrictEqual,types} from 'node:util';
import {createHash} from 'node:crypto';
import {parseNativeProviderJson} from './native-provider-json.js';
import {validateInventorySeparationReview,validateInventorySeparationRequest,validateInventorySeparationReceipt} from './original-inventory-separation-wire.js';
import {decodeNativeOriginalInventoryManifest} from './native-original-inventory-manifest.js';
import {recoveryDeniedEffects,recoveryInstantMicros} from './same-original-recovery-wire.js';

// Fixed private backend ports. Ingress auth is observation only; the owning
// SQL functions MUST check current principal, manifest/fence and exact raw
// original command under transaction locks before issuing an ACK decision.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code='original_inventory_separation_unknown',status=503){throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false});}
function method(object,name){
 if(!object||types.isProxy(object)||typeof object!=='object')fail();
 for(let p=object;p;p=Object.getPrototypeOf(p)){if(types.isProxy(p))fail();const d=Object.getOwnPropertyDescriptor(p,name);
  if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();return d.value;}}
 fail();
}
function closedData(object,keys){
 if(!object||types.isProxy(object)||Object.getPrototypeOf(object)!==Object.prototype||Reflect.ownKeys(object).length!==keys.length)fail();
 for(const key of Reflect.ownKeys(object)){
  const d=Object.getOwnPropertyDescriptor(object,key);if(!keys.includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();
 }
}
function managerExpiryMicros(value){
 const m=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
 if(!m)fail();try{return recoveryInstantMicros(m[1]+'.'+(m[2]??'').padEnd(6,'0')+'Z');}catch{fail();}
}
function currentMicros(){
 // Compare in the same Gregorian ordinal epoch as the original SQL times,
 // not Unix microseconds. Only the current clock is formatted here; original
 // signed/security/source strings and their exact identity remain untouched.
 try{return recoveryInstantMicros(new Date().toISOString().replace('Z','000Z'));}catch{fail();}
}
// Fixed small review/approval/status RPC DATA only. Normal PostgREST jsonb
// returns objects; legacy text returns remain supported. Snapshot descriptors
// before serialization so getters, proxies and toJSON cannot supply values.
function smallRpcDocument(data){
 let nodes=0,characters=0;const active=new Set();
 function copy(value,depth){
  if(depth>24||++nodes>2048)fail();
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){if((characters+=value.length)>24576)fail();return value;}
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))fail();return value;}
  if(!value||typeof value!=='object'||types.isProxy(value)||active.has(value))fail();
  active.add(value);let result;
  if(Array.isArray(value)){
   if(value.length>2048||Reflect.ownKeys(value).length!==value.length+1)fail();result=[];
   for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();result.push(copy(d.value,depth+1));}
  }else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();result={};
   const keys=Reflect.ownKeys(value);if(keys.length>2048)fail();
   for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!d||!Object.hasOwn(d,'value')||!d.enumerable||(characters+=key.length)>24576)fail();
    Object.defineProperty(result,key,{value:copy(d.value,depth+1),enumerable:true});}
  }
  active.delete(value);return result;
 }
 let bytes;try{
  const text=typeof data==='string'?data:JSON.stringify(copy(data,0));
  if(typeof text!=='string'||!text.length||Buffer.byteLength(text,'utf8')>24576)fail();
  bytes=Buffer.from(text,'utf8');return parseNativeProviderJson(bytes);
 }catch{fail();}finally{bytes?.fill(0);}
}
function sameNativePartitions(review,manifest){
 const originals=new Map(manifest.map(row=>[row.namespace,row]));
 return review.length===originals.size&&review.every(row=>isDeepStrictEqual(row,originals.get(row.namespace)));
}
export function createOriginalInventorySeparationStore({db,inspectAuthenticatedIssuer}={}){
 if(typeof inspectAuthenticatedIssuer!=='function'||types.isProxy(inspectAuthenticatedIssuer))fail();
 const rpc=method(db,'rpc'),issued=new WeakSet(),originalReads=new WeakMap();
 function capture(issuer,confirm=false){
  let b;try{b=inspectAuthenticatedIssuer(issuer);}catch{fail('original_inventory_separation_issuer_unbound',403);}
  if(!b||b.issuer!==issuer||b.observation_only!==true||b.transaction_authority!==false||confirm&&b.confirmation_csrf_verified!==true)
   fail('original_inventory_separation_issuer_unbound',403);
  return Object.freeze({p_manager:issuer.manager_id,p_credential:issuer.manager_credential_id,p_device:issuer.manager_device_id,
   p_signed_expires:b.signed_session_expires_at,p_security_session:b.security_session_id,p_password_version:b.security_password_version,
   p_security_hash:b.security_token_hash,p_csrf_hash:b.security_csrf_hash,p_signed_sha:b.signed_session_sha256,
   security_expires:b.security_session_expires_at});
 }
 function unchanged(issuer,b,confirm){if(!isDeepStrictEqual(capture(issuer,confirm),b)||method(db,'rpc')!==rpc)fail('original_inventory_separation_current_source_changed',403);}
 function parameters(b){const {security_expires,p_signed_sha,...rest}=b;return rest;}
 function original(raw,expected,issuer){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>8192)fail('original_inventory_separation_request_invalid',400);
  let decoded;try{decoded=validateInventorySeparationRequest(parseNativeProviderJson(Buffer.from(raw,'utf8')));}catch{fail('original_inventory_separation_request_invalid',400);}
  if(!isDeepStrictEqual(decoded,expected)||decoded.expected_manager_id!==issuer.manager_id
   ||decoded.expected_manager_credential_id!==issuer.manager_credential_id||decoded.expected_manager_device_id!==issuer.manager_device_id)
   fail('original_inventory_separation_request_invalid',400);
  return decoded;
 }
 async function call(name,args,issuer,b,confirm){
  unchanged(issuer,b,confirm);let result,error;
  try{result=await Reflect.apply(rpc,db,[name,Object.freeze(args)]);}catch(cause){error=cause;}
  unchanged(issuer,b,confirm);if(error)fail();
  if(!result||types.isProxy(result))fail();
  for(const key of ['data','error']){const d=Object.getOwnPropertyDescriptor(result,key);if(!d||!Object.hasOwn(d,'value'))fail();}
  if(result.error){if(result.error.code==='42501')fail('original_inventory_separation_current_authority_denied',403);
   if(['23505','40001','22023'].includes(result.error.code))fail('original_inventory_separation_original_conflict',409);fail();}
  if(result.data===null)return null;
  return smallRpcDocument(result.data);
 }
 async function readVerifiedInventory({nativeRequestId,issuer}){
  if(typeof nativeRequestId!=='string'||!UUID.test(nativeRequestId))fail('original_inventory_separation_request_invalid',400);
  const startedMicros=currentMicros(),startedNanos=process.hrtime.bigint();
  const b=capture(issuer),source=await readManifest(issuer,b,nativeRequestId);
  if(source===null)return null;
  if(source.currentUntil<=currentMicros())fail();
  const data=await call('custodial_original_inventory_separation_review_v1',
   {...parameters(b),p_inventory_request:nativeRequestId},issuer,b,false);
  if(source.currentUntil<=currentMicros())fail();
  if(data===null)return null;let review;try{review=validateInventorySeparationReview(data);}catch{fail();}
  const manifest=source.manifest;
  if(review.native_request_id!==nativeRequestId||!isDeepStrictEqual(review.issuer,issuer)
   ||!isDeepStrictEqual(review.original_target,manifest.original_target)
   ||review.inventory_manifest_sha256!==source.manifestSha||review.registration_receipt_sha256!==source.registrationSha
   ||review.retained_key_family_count!==manifest.retained_key_families.length
   ||!sameNativePartitions(review.native_namespaces,manifest.native_namespaces)
   ||!isDeepStrictEqual(review.browser_summary,{declared_domains:manifest.browser_domains.length,record_count:manifest.browser_records.length,
    accepted_exact_original_count:manifest.browser_accepted_exact_original_count,unresolved_retained_count:manifest.browser_unresolved_retained_count,
    frame_sha256:manifest.browser_value_frame.frame_sha256,part_set_sha256:manifest.browser_part_set_sha256}))fail();
  // A complete decoder result is NOT a review. The separate owning SQL review
  // must return this exact retained inventory after current semantic checks.
  unchanged(issuer,b,false);
  // One owning invocation may carry this exact immutable read to the writer.
  // This is provenance/lifetime only, never a cached positive SQL verdict:
  // issue_v1 still reopens the complete current manifest, semantics, original
  // native owner and manager under its own transaction locks. A serialized
  // projection, clone, other issuer/store or expired read cannot supply it.
  const expires=recoveryInstantMicros(review.expires_at);
  const currentUntil=source.currentUntil<expires?source.currentUntil:expires;
  const read=Object.freeze({issuer,b,currentUntil,startedMicros,startedNanos});
  requireReadLifetime(read);originalReads.set(review,read);return review;
 }
 async function readManifest(issuer,b,nativeRequestId){
  unchanged(issuer,b,false);let result;
  try{result=await Reflect.apply(rpc,db,['custodial_original_inventory_separation_manifest_v1',
   Object.freeze({...parameters(b),p_inventory_request:nativeRequestId})]);}catch{fail();}
  unchanged(issuer,b,false);
  // Normal PostgREST responses also carry count/status/statusText. Read only
  // own data/error slots, as the existing fixed RPC path does; those extra SDK
  // transport fields confer no program authority.
  if(!result||types.isProxy(result)||typeof result!=='object')fail();
  for(const key of ['data','error']){const d=Object.getOwnPropertyDescriptor(result,key);if(!d||!Object.hasOwn(d,'value'))fail();}
  if(result.error){if(result.error.code==='42501')fail('original_inventory_separation_current_authority_denied',403);fail();}
  if(result.data===null)return null;
  const data=result.data; // jsonb return, not an unbounded caller JSON parser.
  closedData(data,['schema','state','manifest_utf8','expected_original','original_registration_receipt_sha256',
   'observed_at','current_until','transaction_authority','limits']);
  closedData(data.limits,Object.keys(recoveryDeniedEffects));
  if(data.schema!=='custodial.original-inventory-manifest-manager-source.v1'
   ||data.state!=='CURRENT_MANAGER_ORIGINAL_MANIFEST_DATA_ONLY_NOT_REVIEW_OR_ACK'||data.transaction_authority!==false
   ||Object.keys(recoveryDeniedEffects).some(key=>data.limits[key]!==false)
   ||typeof data.original_registration_receipt_sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.original_registration_receipt_sha256)
   ||typeof data.manifest_utf8!=='string'||Buffer.byteLength(data.manifest_utf8,'utf8')>16777216)fail();
  let observed,until;try{observed=recoveryInstantMicros(data.observed_at);until=recoveryInstantMicros(data.current_until);}catch{fail();}
  const signed=managerExpiryMicros(b.p_signed_expires),security=managerExpiryMicros(b.security_expires);
  if(observed>=until||until-observed>300000000n||until<=currentMicros()||until>signed||until>security)fail();
  let bytes;try{
   bytes=Buffer.from(data.manifest_utf8,'utf8');if(bytes.toString('utf8')!==data.manifest_utf8)fail();
   const manifest=decodeNativeOriginalInventoryManifest(bytes,data.expected_original);
   if(manifest.native_request_id!==nativeRequestId)fail();
   // Detached frozen DATA survives a later awaited RPC without observing a
   // provider-mutated object. No cached manifest becomes effect authority.
   return Object.freeze({manifest,manifestSha:createHash('sha256').update(bytes).digest('hex'),
    registrationSha:data.original_registration_receipt_sha256,currentUntil:until});
  }catch{fail();}finally{bytes?.fill(0);}
 }
 function requireReadLifetime(read){
  // Preserve the original finite interval across auth/RPC awaits, including
  // wall-clock rollback. Elapsed monotonic time may shorten, never renew it.
  const elapsed=process.hrtime.bigint()-read.startedNanos;
  if(elapsed<0n||read.currentUntil<=currentMicros()
   ||read.currentUntil<=read.startedMicros+elapsed/1000n)
   fail('original_inventory_separation_original_read_unavailable',409);
 }
 async function issueOriginalInventoryApprovalOnce({originalRequest,originalRequestUtf8,issuer,verifiedReview}){
  if(!issuer||issued.has(issuer))fail('original_inventory_separation_attempt_used',409);
  issued.add(issuer); // Includes invalid/uncertain dispatch; no in-call retry.
  const read=originalReads.get(verifiedReview);
  originalReads.delete(verifiedReview); // Consume before any possibly uncertain dispatch.
  const b=capture(issuer,true),request=original(originalRequestUtf8,originalRequest,issuer);
  function requireOriginalRead(){
   if(!read||read.issuer!==issuer||!isDeepStrictEqual(read.b,b))
    fail('original_inventory_separation_original_read_unavailable',409);
   requireReadLifetime(read);
   unchanged(issuer,b,true);
  }
  requireOriginalRead();
  let review;try{review=validateInventorySeparationReview(verifiedReview);}catch{fail('original_inventory_separation_review_invalid',400);}
  if(request.native_request_id!==review.native_request_id||request.expected_review_sha256!==review.review_sha256
   ||request.expected_inventory_manifest_sha256!==review.inventory_manifest_sha256
   ||request.expected_registration_receipt_sha256!==review.registration_receipt_sha256
   ||request.expected_separation_authority_revision!==review.original_target.separation_authority_revision
   ||!isDeepStrictEqual(review.issuer,issuer))fail('original_inventory_separation_original_conflict',409);
  requireOriginalRead();
  const data=await call('custodial_original_inventory_separation_issue_v1',
   {...parameters(b),p_signed_sha:b.p_signed_sha,p_original_utf8:originalRequestUtf8},issuer,b,true);
  requireOriginalRead(); // A late reply stays UNKNOWN; only original status may recover it.
  if(data===null)return null;let receipt;try{receipt=validateInventorySeparationReceipt(data);}catch{fail();}
  if(!isDeepStrictEqual(receipt.original_request,request)||!isDeepStrictEqual(receipt.original_target,review.original_target)
   ||receipt.original_request_sha256!==createHash('sha256').update(originalRequestUtf8,'utf8').digest('hex')
   ||!isDeepStrictEqual(receipt.issuer,issuer))fail();return receipt;
 }
 async function readOriginalInventoryApproval({originalRequest,originalRequestUtf8,issuer}){
  const b=capture(issuer,true),request=original(originalRequestUtf8,originalRequest,issuer);
  const data=await call('custodial_original_inventory_separation_status_v1',
   {...parameters(b),p_original_utf8:originalRequestUtf8},issuer,b,true);
  if(data===null)return null;let receipt;try{receipt=validateInventorySeparationReceipt(data);}catch{fail();}
  if(!isDeepStrictEqual(receipt.original_request,request)||!isDeepStrictEqual(receipt.issuer,issuer)
   ||receipt.original_request_sha256!==createHash('sha256').update(originalRequestUtf8,'utf8').digest('hex'))fail();
  return receipt; // Historical outcome, not fresh native finalizer authority.
 }
 return Object.freeze({readVerifiedInventory,issueOriginalInventoryApprovalOnce,readOriginalInventoryApproval});
}
