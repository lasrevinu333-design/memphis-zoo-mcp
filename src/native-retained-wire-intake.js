import {createHash,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createSupabaseDeviceCredentialStore,deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';
import {verifyNativeProtectedSnapshotOriginalGeneration} from './native-protected-snapshot-generation.js';
import {recordPreparedAuthenticatedNativeValueChunk} from './native-retained-value-chunk-recorder.js';

// SOURCE CANDIDATE. Digest-only evidence and separately readback-confirmed raw
// value chunks remain distinct; neither means accepted work, inventory ACK,
// key deletion or phone reuse. No custom signer,
// generic RPC/function, cookie/ordinary-auth fallback, or automatic write retry.
export const retainedNativeIntakePath='/device-auth/separation-evidence';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const KEYS=['schema','operation_id','generation_id','signed_wire_base64'];
const CHUNK_KEYS=[...KEYS,'value_bytes','value_sha256','chunk_index','chunk_count','chunk_base64','chunk_sha256'];
const READBACK_KEYS=[...KEYS,'native_request_id','request_body_sha256','attestation_digest'];
// 24 KiB leaves space even for a maximum 256 KiB original wire, its base64
// expansion and the closed metadata within the unchanged 384 KiB body cap.
const CHUNK_BYTES=24576,VALUE_BYTES=40*1024*1024;
export const nativeValueChunkTransportLimits=Object.freeze({chunk_bytes:CHUNK_BYTES,value_bytes:VALUE_BYTES,chunks:Math.ceil(VALUE_BYTES/CHUNK_BYTES),request_bytes:393216});
const CONTEXT=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id','assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'];
const RECEIPT=['assignment_epoch','authority_revision','automatic_acceptance','browser_inventory_state','canonical_device_id','credential_id','cutoff_at','device_id','employee_id','generation_id','inventory_acknowledged','manifest_sha256','native_semantic_inventory_state','new_work_allowed','operation_id','payload_coverage','phone_released','raw_snapshot_sha256','receipt_sha256','record_count','record_values_retained','retained_at','schema','separation_id','status','wire_bytes','wire_sha256','work_accepted'];
const exact=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...k].sort());
const hash=v=>createHash('sha256').update(v).digest('hex');
const authenticatedCaptures=new WeakSet();
const authenticatedChunkCaptures=new WeakSet();
const authenticatedReadbackCaptures=new WeakSet();
const error=(code,status)=>{throw Object.assign(new Error(code),{code,status});};
const invalid=()=>error('native_evidence_request_invalid',400),denied=()=>error('native_evidence_proof_invalid',403),pending=()=>error('native_evidence_retention_pending',503);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const equalHash=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

// Legacy digest envelopes contain four strings; value-chunk envelopes contain
// ten. Closed string-object grammar rejects duplicate keys, including escaped
// duplicates,
// BOM, nested values,
// non-UTF8 and trailing material are refused before any asynchronous lookup.
function parseEnvelope(bytes,chunk=false,readback=false){
 if(chunk&&readback)invalid();
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>393216)invalid();let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid();}
 const keys=readback?READBACK_KEYS:chunk?CHUNK_KEYS:KEYS;
 let at=0;const space=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const string=()=>{space();if(text[at]!=='"')invalid();const start=at++;while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"'){try{return JSON.parse(text.slice(start,at));}catch{invalid();}}}invalid();};
 space();if(text[at++]!=='{')invalid();const seen=new Set(),rows=[];while(true){const k=string();if(seen.has(k)||!keys.includes(k))invalid();seen.add(k);space();if(text[at++]!==':')invalid();const v=string();rows.push([k,v]);space();const end=text[at++];if(end==='}')break;if(end!==','||rows.length>=keys.length)invalid();}
 space();if(at!==text.length||rows.length!==keys.length)invalid();const result=Object.fromEntries(rows);
 if(result.schema!==(readback?'custodial.original-native-evidence-readback.v1':chunk?'custodial.original-native-value-chunk-intake.v1':'custodial.original-native-evidence-intake.v1')||!UUID.test(result.operation_id)||!UUID.test(result.generation_id)
  ||!result.signed_wire_base64||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.signed_wire_base64))invalid();
 const wire=Buffer.from(result.signed_wire_base64,'base64');if(!wire.length||wire.length>262144||wire.toString('base64')!==result.signed_wire_base64)invalid();
 if(readback&&(!UUID.test(result.native_request_id)||!SHA.test(result.request_body_sha256)||!SHA.test(result.attestation_digest)))invalid();
 if(chunk){
  for(const key of ['value_bytes','chunk_index','chunk_count'])if(!/^(?:0|[1-9][0-9]*)$/.test(result[key])||result[key].length>8)invalid();
  const total=Number(result.value_bytes),index=Number(result.chunk_index),count=Number(result.chunk_count);
  if(total<1||total>VALUE_BYTES||count!==Math.ceil(total/CHUNK_BYTES)||index>=count
   ||!SHA.test(result.value_sha256)||!SHA.test(result.chunk_sha256)||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.chunk_base64))invalid();
  const part=Buffer.from(result.chunk_base64,'base64');
  if(part.toString('base64')!==result.chunk_base64||part.length!==Math.min(CHUNK_BYTES,total-index*CHUNK_BYTES)||hash(part)!==result.chunk_sha256)invalid();
 }
 return Object.freeze(result);
}
export const parseRetainedNativeEnvelope=bytes=>parseEnvelope(bytes);
function time(v){const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)pending();const[y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)pending();return v;}
async function oneRead(run,sql,key){let rows;try{rows=await run(sql);}catch{pending();}if(!Array.isArray(rows)||rows.length!==1||!exact(rows[0],[key])||!rows[0][key])pending();try{return freeze(structuredClone(rows[0][key]));}catch{pending();}}

async function captureOriginalNativeEvidence(req,{env=process.env,store,runReadOnlySql,now=new Date()}={},chunk=false,readback=false){
 if(req?.method!=='POST'||req?.originalUrl!==retainedNativeIntakePath)invalid();const headers=Object.freeze({...req.headers});
 for(const k of ['authorization','origin','x-device-id','x-memphis-app-edition','x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])if(typeof headers[k]!=='string')denied();
 if(headers.origin!=='https://localhost'||headers['x-memphis-app-edition']!=='custodial'||!/^Device \S+$/.test(headers.authorization)||!/^KIOSK_(?:0[2-9]|10)$/.test(headers['x-device-id']))denied();
 if(!Buffer.isBuffer(req.scanAuthorityRawBody))invalid();const raw=Buffer.from(req.scanAuthorityRawBody),frame=parseEnvelope(raw,chunk,readback);if(!isDeepStrictEqual(frame,req.body))invalid();
 const parts=credentials.credentialTokenParts(headers.authorization.slice(7));if(!parts||!UUID.test(parts.credentialId))denied();const clock=new Date(now.getTime());if(!Number.isFinite(clock.getTime()))denied();
 let credentialHash,keyId;try{credentialHash=credentials.tokenHash(parts.secret,env);keyId=credentials.deviceCredentialSecretKeyId(env);}catch{pending();}
 // Raw original bytes and identifying principal are captured before any await.
 const wire=Buffer.from(frame.signed_wire_base64,'base64');let untrustedBody,principalDigest;
 try{const w=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(wire));if(typeof w.manifest_body!=='string'||Buffer.byteLength(w.manifest_body)>131072)invalid();untrustedBody=JSON.parse(w.manifest_body);const p=untrustedBody.original_principal;if(!p||Array.isArray(p)||Object.getPrototypeOf(p)!==Object.prototype)invalid();principalDigest=hash(JSON.stringify(['custodial.native-provider-principal.v1',...Object.keys(p).sort().map(k=>[k,p[k]])]));}catch{invalid();}
 if(!store||typeof store.findCredential!=='function'||typeof runReadOnlySql!=='function')pending();
 let device,row;try{device=freeze(structuredClone(await resolveCanonicalDevice({runReadOnlySql,deviceIdentifier:headers['x-device-id']})));}catch{pending();}
 if(!device||device.canonical_device_id!==headers['x-device-id']||device.device_active!==true||device.employee_active!==false||!/^EMP\d+$/i.test(String(device.employee_code||''))||!UUID.test(device.canonical_device_pk||'')||!UUID.test(device.assigned_employee_id||'')||!Number.isSafeInteger(Number(device.assignment_epoch))||Number(device.assignment_epoch)<1)denied();
 try{row=freeze(structuredClone(await store.findCredential(parts.credentialId)));}catch{pending();}const metadata=row?.metadata_json;
 if(!row||row.credential_id!==parts.credentialId||row.device_id!==device.canonical_device_pk||row.revoked_at||!row.confirmed_at||!equalHash(row.token_hash,credentialHash)
  ||metadata!==null&&metadata!==undefined&&Object.getPrototypeOf(metadata)!==Object.prototype)denied();
 if(metadata&&Object.hasOwn(metadata,'credential_secret_key_id')&&(typeof metadata.credential_secret_key_id!=='string'||!SHA.test(metadata.credential_secret_key_id)||!equalHash(metadata.credential_secret_key_id,keyId)))denied();
 let a;try{a=verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:retainedNativeIntakePath,headers,scanAuthorityRawBody:raw,memphisDevice:device,memphisDeviceCredential:row},{now:clock});}catch{denied();}
 const context=await oneRead(runReadOnlySql,`select public.custodial_v13_read_separation_context('${device.canonical_device_pk}'::uuid,'${parts.credentialId}'::uuid) as context`,'context');
 if(!exact(context,CONTEXT)||context.device_id!==device.canonical_device_pk||context.credential_id!==parts.credentialId||context.employee_id!==device.assigned_employee_id||context.canonical_device_id!==device.canonical_device_id||context.assignment_epoch!==Number(device.assignment_epoch)
  ||context.schema!=='custodial.separation-context.v1'||context.purpose!=='SEPARATION_STATUS_ONLY'||context.state!=='PENDING_RECONCILIATION'||context.new_work_allowed!==false||context.phone_released!==false||!UUID.test(context.separation_id||''))pending();time(context.cutoff_at);
 const original=await oneRead(runReadOnlySql,`select public.custodial_v14_read_separation_generation('${context.device_id}'::uuid,'${context.credential_id}'::uuid,'${context.separation_id}'::uuid,'${frame.generation_id}'::uuid,'${principalDigest}'::text) as original_generation`,'original_generation');
 let binding;try{binding=verifyNativeProtectedSnapshotOriginalGeneration(wire,{separationContext:context,originalGeneration:original,credentialToken:parts.credentialId+'.'+parts.secret});}catch{denied();}
 const transcript=JSON.stringify([a.version,a.credential_id,a.device_id,a.method,a.path,a.body_sha256,a.request_id,a.timestamp,a.signature]);
 // Primitive strings/frozen objects only; never return token/header secrets.
 const capture=freeze({purpose:readback?'ORIGINAL_NATIVE_EVIDENCE_READBACK_ONLY':chunk?'ORIGINAL_NATIVE_VALUE_CHUNK_PREPARATION_ONLY':'ORIGINAL_NATIVE_EVIDENCE_RETENTION_ONLY',operation_id:frame.operation_id,generation_id:frame.generation_id,
  device_id:context.device_id,credential_id:context.credential_id,credential_hash:credentialHash,credential_key_id:keyId,
  native_request_id:a.request_id,attestation_digest:hash(transcript),request_body_sha256:a.body_sha256,request_base64:raw.toString('base64'),
  wire_sha256:hash(wire),wire_bytes:wire.length,context,verified_binding:binding,
  ...(chunk?{value_chunk:{value_bytes:Number(frame.value_bytes),value_sha256:frame.value_sha256,chunk_index:Number(frame.chunk_index),chunk_count:Number(frame.chunk_count),chunk_base64:frame.chunk_base64,chunk_sha256:frame.chunk_sha256}}:{}),
  ...(readback?{target_request:{native_request_id:frame.native_request_id,request_body_sha256:frame.request_body_sha256,attestation_digest:frame.attestation_digest}}:{})});
 (readback?authenticatedReadbackCaptures:chunk?authenticatedChunkCaptures:authenticatedCaptures).add(capture);return capture;
}
export const captureAuthenticatedNativeEvidence=(req,options)=>captureOriginalNativeEvidence(req,options);
// Separate authenticated chunk brand. The owning handler selects this branch
// only for the closed chunk schema; capture still binds exact original bytes,
// retired actor and generation. No new RPC, native emitter, credential fallback
// or increased transport cap.
export const captureAuthenticatedNativeValueChunk=(req,options)=>captureOriginalNativeEvidence(req,options,true);
// Fresh original-principal authentication for exactly one OLD request witness.
// This separate brand is never accepted by either writer or value matcher.
export const captureAuthenticatedNativeEvidenceReadback=(req,options)=>captureOriginalNativeEvidence(req,options,false,true);

// Internal read-only seam for later value retention. A JSON copy or caller
// claim cannot acquire this authority: only this module's authenticated capture
// is branded. Expose original digest rows, never token/header/hash secrets.
export function originalRetainedRecordDigestAuthority(capture){
 if(!capture||!authenticatedCaptures.has(capture)&&!authenticatedChunkCaptures.has(capture))pending();
 const frame=parseEnvelope(Buffer.from(capture.request_base64,'base64'),authenticatedChunkCaptures.has(capture));
 const wire=JSON.parse(Buffer.from(frame.signed_wire_base64,'base64').toString('utf8'));
 const body=JSON.parse(wire.manifest_body);
 if(wire.manifest_sha256!==capture.verified_binding.manifest_sha256
  ||body.raw_snapshot_sha256!==capture.verified_binding.raw_snapshot_sha256
  ||body.records.length!==capture.verified_binding.record_count)pending();
 return freeze({schema:'custodial.authenticated-native-record-digests.v1',operation_id:capture.operation_id,
  generation_id:capture.generation_id,separation_id:capture.context.separation_id,
  manifest_sha256:wire.manifest_sha256,raw_snapshot_sha256:body.raw_snapshot_sha256,
  record_count:body.record_count,records:structuredClone(body.records)});
}
export function originalRetainedValueChunkAuthority(capture){
 if(!capture||!authenticatedChunkCaptures.has(capture))pending();
 return freeze({...originalRetainedRecordDigestAuthority(capture),schema:'custodial.authenticated-native-value-chunk.v1',
  wire_sha256:capture.wire_sha256,native_request_id:capture.native_request_id,request_body_sha256:capture.request_body_sha256,
  ...capture.value_chunk,record_values_retained:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,phone_released:false});
}

function receipt(value,capture){const c=capture,b=c.verified_binding,x=c.context;if(!exact(value,RECEIPT))pending();
 const expected={schema:'custodial.retained-original-native-evidence-receipt.v1',status:'RETAINED_ONLY_PENDING_RECONCILIATION',operation_id:c.operation_id,separation_id:x.separation_id,generation_id:c.generation_id,device_id:x.device_id,canonical_device_id:x.canonical_device_id,credential_id:x.credential_id,employee_id:x.employee_id,assignment_epoch:x.assignment_epoch,authority_revision:x.authority_revision,cutoff_at:x.cutoff_at,wire_sha256:c.wire_sha256,wire_bytes:c.wire_bytes,manifest_sha256:b.manifest_sha256,raw_snapshot_sha256:b.raw_snapshot_sha256,record_count:b.record_count,payload_coverage:'MANIFEST_AND_RECORD_DIGESTS_ONLY',record_values_retained:false,native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,automatic_acceptance:false,work_accepted:false,new_work_allowed:false,phone_released:false};
 for(const [k,v]of Object.entries(expected))if(!isDeepStrictEqual(value[k],v))pending();if(typeof value.receipt_sha256!=='string'||!SHA.test(value.receipt_sha256))pending();if(time(value.retained_at)<time(x.cutoff_at))pending();return freeze(structuredClone(value));}
const definite=code=>({42501:403,22023:400,23505:409,23514:409,40001:409})[code];
export async function recordAuthenticatedNativeEvidence(capture,{db}={}){
 if(!capture||!authenticatedCaptures.has(capture))pending();const c=freeze(structuredClone(capture));if(c?.purpose!=='ORIGINAL_NATIVE_EVIDENCE_RETENTION_ONLY'||!UUID.test(c.operation_id||'')||!UUID.test(c.native_request_id||''))pending();if(!db||typeof db.rpc!=='function')pending();
 const args=Object.freeze({p_operation:c.operation_id,p_device:c.device_id,p_credential:c.credential_id,p_credential_hash:c.credential_hash,p_credential_key_id:c.credential_key_id,p_generation:c.generation_id,p_native_request:c.native_request_id,p_attestation_digest:c.attestation_digest,p_request_base64:c.request_base64,p_binding:c.verified_binding});
 let written=null;try{const r=await db.rpc('custodial_v15_retain_original_native_evidence',args);if(r?.error&&definite(r.error.code))error('native_evidence_retention_conflict_or_denied',definite(r.error.code));if(!r?.error&&r?.data)written=structuredClone(r.data);}catch(e){if([400,403,409].includes(e?.status))throw e;/* uncertain outcome: read, never resend */}
 const readArgs=Object.freeze({p_operation:c.operation_id,p_device:c.device_id,p_credential:c.credential_id,p_credential_hash:c.credential_hash,p_credential_key_id:c.credential_key_id,p_native_request:c.native_request_id});let result;try{result=await db.rpc('custodial_v15_read_retained_native_evidence',readArgs);}catch{pending();}
 if(result?.error){const status=definite(result.error.code);if(status)error('native_evidence_readback_denied',status);pending();}
 const r=result?.data;if(!exact(r,['receipt','stored_wire_sha256','stored_wire_bytes','request'])||r.stored_wire_sha256!==c.wire_sha256||r.stored_wire_bytes!==c.wire_bytes
  ||!exact(r.request,['operation_id','native_request_id','attestation_digest','request_body_sha256'])||r.request.operation_id!==c.operation_id||r.request.native_request_id!==c.native_request_id||r.request.attestation_digest!==c.attestation_digest||r.request.request_body_sha256!==c.request_body_sha256)pending();
 const retained=receipt(r.receipt,c);
 if(written){if(!exact(written,['receipt','replayed','native_request_id','request_body_sha256'])||typeof written.replayed!=='boolean'||written.native_request_id!==c.native_request_id||written.request_body_sha256!==c.request_body_sha256||!isDeepStrictEqual(receipt(written.receipt,c),retained))pending();}
 return freeze({ok:true,data:{schema:'custodial.original-native-evidence-intake-result.v1',status:'RETAINED_ONLY_PENDING_RECONCILIATION',native_request_id:c.native_request_id,request_body_sha256:c.request_body_sha256,
  receipt:retained,commit_readback_confirmed:true,request_readback_confirmed:true,write_outcome_reconciled:written===null,evidence_retained:true,record_values_retained:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,phone_released:false}});
}
const READBACK_PART=['schema','operation_id','native_request_id','request_body_sha256','attestation_digest','wire_sha256','value_bytes','value_sha256','chunk_index','chunk_count','chunk_bytes','chunk_sha256','chunk_base64','stored_chunk_count','record_values_retained','native_semantic_inventory_state','browser_inventory_state','inventory_acknowledged','work_accepted','new_work_allowed','phone_released','key_removal'];
function readbackPart(value,c,target){
 if(!exact(value,READBACK_PART)||value.schema!=='custodial.private-native-value-chunk-readback.v1'
  ||value.operation_id!==c.operation_id||value.native_request_id!==target.native_request_id
  ||value.request_body_sha256!==target.request_body_sha256||value.attestation_digest!==target.attestation_digest
  ||value.wire_sha256!==c.wire_sha256)pending();
 for(const k of ['inventory_acknowledged','work_accepted','new_work_allowed','phone_released','key_removal'])if(value[k]!==false)pending();
 for(const k of ['native_semantic_inventory_state','browser_inventory_state'])if(value[k]!=='UNKNOWN')pending();
 if(!Number.isSafeInteger(value.value_bytes)||value.value_bytes<1||value.value_bytes>VALUE_BYTES
  ||!Number.isSafeInteger(value.chunk_index)||value.chunk_index<0
  ||!Number.isSafeInteger(value.chunk_count)||value.chunk_count!==Math.ceil(value.value_bytes/CHUNK_BYTES)||value.chunk_index>=value.chunk_count
  ||!Number.isSafeInteger(value.stored_chunk_count)||value.stored_chunk_count<1||value.stored_chunk_count>value.chunk_count
  ||typeof value.record_values_retained!=='boolean'||value.record_values_retained&&value.stored_chunk_count!==value.chunk_count
  ||!SHA.test(value.value_sha256)||!SHA.test(value.chunk_sha256)
  ||typeof value.chunk_base64!=='string'||value.chunk_base64.length>32768||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.chunk_base64))pending();
 const bytes=Buffer.from(value.chunk_base64,'base64');
 if(bytes.length!==Math.min(CHUNK_BYTES,value.value_bytes-value.chunk_index*CHUNK_BYTES)||value.chunk_bytes!==bytes.length
  ||bytes.toString('base64')!==value.chunk_base64||hash(bytes)!==value.chunk_sha256)pending();
 // Deliberate metadata-only projection: raw bytes/headers/credential material
 // and the old actual attestation are never exposed by this HTTP result.
 return freeze({value_bytes:value.value_bytes,value_sha256:value.value_sha256,chunk_index:value.chunk_index,chunk_count:value.chunk_count,
  chunk_sha256:value.chunk_sha256,stored_chunk_count:value.stored_chunk_count,record_values_retained:value.record_values_retained});
}
export async function readAuthenticatedNativeEvidence(capture,{db}={}){
 if(!capture||!authenticatedReadbackCaptures.has(capture))pending();
 const c=freeze(structuredClone(capture)),target=c.target_request;
 if(c.purpose!=='ORIGINAL_NATIVE_EVIDENCE_READBACK_ONLY'||!exact(target,['native_request_id','request_body_sha256','attestation_digest'])
  ||!UUID.test(target.native_request_id)||!SHA.test(target.request_body_sha256)||!SHA.test(target.attestation_digest)
  ||target.native_request_id===c.native_request_id||!db||typeof db.rpc!=='function')pending();
 const base={schema:'custodial.original-native-evidence-readback-result.v1',operation_id:c.operation_id,
  query_native_request_id:c.native_request_id,native_request_id:target.native_request_id,request_body_sha256:target.request_body_sha256,
  query_completed:true,write_performed:false,resend_allowed:false,absence_proves_no_late_commit:false,
  native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,automatic_acceptance:false,
  work_accepted:false,new_work_allowed:false,phone_released:false,key_removal:false};
 const unknown=()=>freeze({ok:true,data:{...base,status:'OUTCOME_UNKNOWN',requested_attempt_retained:null,
  request_readback_confirmed:false,record_values_retained:null}});
 let result;try{result=await db.rpc('custodial_v15_read_retained_native_evidence',Object.freeze({
  p_operation:c.operation_id,p_device:c.device_id,p_credential:c.credential_id,p_credential_hash:c.credential_hash,
  p_credential_key_id:c.credential_key_id,p_native_request:target.native_request_id}));}catch{pending();}
 if(result?.error){const status=definite(result.error.code);if(status)error('native_evidence_readback_denied',status);pending();}
 if(!result||!Object.hasOwn(result,'data')||result.data===undefined)pending();
 if(result.data===null)return unknown();
 const r=result.data,hasPart=Object.hasOwn(r,'value_chunk');
 if(!exact(r,hasPart?['receipt','stored_wire_sha256','stored_wire_bytes','request','value_chunk']:['receipt','stored_wire_sha256','stored_wire_bytes','request'])
  ||r.stored_wire_sha256!==c.wire_sha256||r.stored_wire_bytes!==c.wire_bytes)pending();
 const retained=receipt(r.receipt,c);
 if(r.request===null){if(hasPart)pending();return unknown();}
 if(!exact(r.request,['operation_id','native_request_id','attestation_digest','request_body_sha256']))pending();
 if(r.request.operation_id!==c.operation_id||r.request.native_request_id!==target.native_request_id
  ||r.request.attestation_digest!==target.attestation_digest||r.request.request_body_sha256!==target.request_body_sha256)
  error('native_evidence_readback_identity_conflict',409);
 const part=hasPart&&r.value_chunk!==null?readbackPart(r.value_chunk,c,target):null;
 return freeze({ok:true,data:{...base,status:part?(part.record_values_retained?'RAW_VALUES_RETAINED_PENDING_SEMANTIC_RECONCILIATION':'CHUNK_RETAINED_INCOMPLETE_VALUES'):'REQUEST_RETAINED_ONLY_PENDING_RECONCILIATION',
  requested_attempt_retained:true,request_readback_confirmed:true,receipt:retained,
  record_values_retained:part?part.record_values_retained:false,chunk_bytes_readback_confirmed:!!part,...(part?{value_chunk:part}:{})}});
}
export function createRetainedNativeEvidenceHandler({env=process.env,store,runReadOnlySql,db,now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   // This parsed discriminator is routing only, never authentication authority.
   // All branches synchronously snapshot the original bytes, parse their own
   // closed envelope and require equality to req.body before any lookup.
   const chunk=req.body?.schema==='custodial.original-native-value-chunk-intake.v1';
   const readback=req.body?.schema==='custodial.original-native-evidence-readback.v1';
   const options={env,store,runReadOnlySql,...(now?{now:now()}: {})};
   const capture=await (readback?captureAuthenticatedNativeEvidenceReadback:chunk?captureAuthenticatedNativeValueChunk:captureAuthenticatedNativeEvidence)(req,options);
   return res.json(await (readback?readAuthenticatedNativeEvidence:chunk?recordPreparedAuthenticatedNativeValueChunk:recordAuthenticatedNativeEvidence)(capture,{db}));
  }catch(e){
   const status=[400,403,409,503].includes(e?.status)?e.status:503;
   return res.status(status).json({ok:false,code:status===400?'native_evidence_request_invalid':status===403?'native_evidence_proof_invalid':status===409?'native_evidence_identity_conflict':'native_evidence_retention_pending'});
  }
 };
}

// Explicit canonical route installation only. Global restore/CORS/raw-body
// controls in the owning entrypoint stay intact. No ordinary-auth middleware
// fallback: this handler authenticates the exact retired purpose-only actor.
export function installRetainedNativeEvidenceRoute(app,{env=process.env,db,store,runReadOnlySql,now}={}){
 if(!app||typeof app.post!=='function')throw new TypeError('owning HTTP app required');
 const credentialStore=store||(db?createSupabaseDeviceCredentialStore(db):undefined);
 app.post(retainedNativeIntakePath,createRetainedNativeEvidenceHandler({env,db,store:credentialStore,runReadOnlySql,now}));
}
