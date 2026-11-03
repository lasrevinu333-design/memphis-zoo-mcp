import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {deviceCredentialInternals as credentials,verifyNativeDeviceRequestAttestation} from './auth/device-credential-auth.js';
import {resolveCanonicalDevice} from './device-identity.js';
import {verifyNativeProtectedSnapshotOriginalGeneration} from './native-protected-snapshot-generation.js';
import {privateCustodyRecordSyntaxLimits} from './native-private-custody-record.js';
import {inspectPrivateCustodyTransportFrameOriginalBinding} from './native-private-custody-transport-frame.js';
import {decodeCurrentOriginalPrivateQueryRead,currentOriginalPrivateQueryReadWire} from './native-private-custody-current-query-wire.js';
import {verifyArchivedOriginalPrivateQueryProof} from './native-private-custody-archived-query-proof.js';
import {validateRecoveryOriginalTarget,recoveryDocumentSha256,recoveryDeniedEffects} from './same-original-recovery-wire.js';
import {decodeSameOriginalRecoveryNativeChallenge,decodeSameOriginalRecoveryNativeStatus,decodeSameOriginalRecoveryNativePreparationRead} from './same-original-recovery-native-challenge-wire.js';
import {decodeSameOriginalCompletionRead,sameOriginalCompletionReadWire} from './same-original-completion-read-wire.js';

// UNMOUNTED separate private-custody protocol. No old WORK capture/brand/writer
// is reused as custody authority. Original signed WORK is an identity link only.
// Current observed auth is NOT an atomic database transaction or semantic ACK.
export const privateCustodyExchangePath='/device-auth/private-custody';
export const privateCustodyCurrentQueryPath='/device-auth/private-custody-current-read';
export const sameOriginalRecoveryTargetPath='/device-auth/same-original-recovery/target';
export const sameOriginalRecoveryNativeChallengePath='/device-auth/same-original-recovery/challenge';
export const sameOriginalRecoveryNativeStatusPath='/device-auth/same-original-recovery/challenge-status';
export const sameOriginalRecoveryNativePreparationPath='/device-auth/same-original-recovery/manager-preparation';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
 OP=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
 PLAN='custodial.native-private-eight-custody-chunk-identity-plan.v1',OWNER='custodial-native-private-custody-owner-proof.v1',MAX_REQUEST=393216,CHUNK=24576,
 MAX_FRAME=privateCustodyRecordSyntaxLimits.record_bytes+8192+4+4+'custodial.native-private-eight-custody-transport-frame.v1'.length*2+4+4+32,
 COMMON=['schema','operation_id','original_generation_id','principal_digest','engine_revision','original_frozen_work_sha256','frame_sha256','record_sha256','plan_sha256','frame_bytes','chunk_count','chunk_index','offset','chunk_bytes','chunk_sha256','write_id','attempt_id','read_query_id','owner_proof_base64','original_signed_wire_base64','purpose_binding_sha256','purpose_attestation'],
 TARGET=['target_native_request_id','target_request_body_sha256','target_attestation_digest','target_prepared_record_sha256','target_unknown_record_sha256'],
 OWNER_FIELDS=['schema','credential_id','original_wire_sha256','record_sha256','record_bytes','capsule_sha256','aad_binding_sha256','source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256','principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'],
 CONTEXT=['schema','separation_id','authority_revision','employee_id','device_id','canonical_device_id','credential_id','assignment_epoch','cutoff_at','state','native_inventory_state','server_known_open_sessions','new_work_allowed','phone_released','purpose'],
 captures=new WeakMap(),consumedWrites=new WeakSet(),consumedReturnedPieces=new WeakSet(),hash=x=>createHash('sha256').update(x).digest('hex'),freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;},
 fail=(code='native_private_custody_request_invalid',status=403)=>{throw Object.assign(new Error(code),{code,status});},
 equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&SHA.test(a)&&SHA.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b)),
 exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const typedBytesPrototype=Object.getPrototypeOf(Uint8Array.prototype),
 actualBuffer=Object.getOwnPropertyDescriptor(typedBytesPrototype,'buffer').get,
 actualLength=Object.getOwnPropertyDescriptor(typedBytesPrototype,'byteLength').get,
 actualOffset=Object.getOwnPropertyDescriptor(typedBytesPrototype,'byteOffset').get;
function owned(bytes,max){
 if(!Buffer.isBuffer(bytes)||Object.getPrototypeOf(bytes)!==Buffer.prototype)fail();
 const backing=actualBuffer.call(bytes),length=actualLength.call(bytes);
 if(backing instanceof SharedArrayBuffer||!length||length>max)fail();
 return Buffer.from(new Uint8Array(backing,actualOffset.call(bytes),length));
}
function flat(bytes,keys){const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);let at=0;const seen=new Set(),rows=[];
 const ws=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;};const str=()=>{ws();if(text[at++]!=='"')fail();const start=at-1;while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"')return JSON.parse(text.slice(start,at));}fail();};
 ws();if(text[at++]!=='{')fail();while(true){const k=str();if(seen.has(k)||!keys.includes(k))fail();seen.add(k);ws();if(text[at++]!==':')fail();rows.push([k,str()]);ws();const c=text[at++];if(c==='}')break;if(c!==','||rows.length>=keys.length)fail();}
 ws();if(at!==text.length||rows.length!==keys.length)fail();return freeze(Object.fromEntries(rows));}
function decimal(value,min,max){if(typeof value!=='string'||! /^(?:0|[1-9][0-9]*)$/.test(value)||value.length>16)fail();const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)fail();return n;}
function b64(value,max){if(typeof value!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(value))fail();const b=Buffer.from(value,'base64');if(!b.length||b.length>max||b.toString('base64')!==value){b.fill(0);fail();}return b;}
function uuid5(namespace,name){const bytes=createHash('sha1').update(Buffer.from(namespace.replaceAll('-',''),'hex')).update(name,'ascii').digest().subarray(0,16);bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;const h=bytes.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
function parse(bytes){let mode,p;try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),candidate=JSON.parse(text);mode=candidate?.schema==='custodial.original-native-private-custody-write.v1'?'WRITE':candidate?.schema==='custodial.original-native-private-custody-query.v1'?'QUERY':null;if(!mode)fail();p=flat(bytes,[...COMMON,...(mode==='WRITE'?['chunk_base64']:TARGET)]);}catch{fail();}
 if(!OP.test(p.operation_id)||!UUID.test(p.original_generation_id))fail();for(const key of ['principal_digest','original_frozen_work_sha256','frame_sha256','record_sha256','plan_sha256','chunk_sha256','purpose_binding_sha256','purpose_attestation'])if(!SHA.test(p[key]))fail();
 const total=decimal(p.frame_bytes,1,MAX_FRAME),count=decimal(p.chunk_count,1,Math.ceil(MAX_FRAME/CHUNK)),index=decimal(p.chunk_index,0,count-1),offset=decimal(p.offset,0,MAX_FRAME),length=decimal(p.chunk_bytes,1,CHUNK);decimal(p.engine_revision,0,Number.MAX_SAFE_INTEGER);
 if(count!==Math.ceil(total/CHUNK)||offset!==index*CHUNK||length!==Math.min(CHUNK,total-offset))fail();for(const [key,purpose]of [['write_id','write'],['attempt_id','attempt'],['read_query_id','query']])if(p[key]!==uuid5(p.operation_id,[PLAN,p.frame_sha256,p.chunk_index,purpose].join('\n')))fail();
 if(mode==='QUERY'){if(p.target_native_request_id!==p.attempt_id)fail();for(const key of TARGET.slice(1))if(!SHA.test(p[key]))fail();}
 const digest=hash(Object.keys(p).filter(k=>!['purpose_binding_sha256','purpose_attestation'].includes(k)).sort().map(k=>k+'='+p[k]).join('\n'));if(!equal(digest,p.purpose_binding_sha256))fail();return {mode,p,total,count,index,length};}
async function one(read,sql,key){let rows;try{rows=await read(sql);}catch{fail('native_private_custody_auth_pending',503);}if(!Array.isArray(rows)||rows.length!==1||!exact(rows[0],[key])||!rows[0][key])fail();return freeze(structuredClone(rows[0][key]));}
export async function captureAuthenticatedPrivateCustodyExchange(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},false);
}
// A distinct read-only transport authenticates NOW while preserving the exact
// issued original QUERY body/time/HMAC/target. Never a renewed write or QUERY.
// The local UNKNOWN digest is an opaque correlation value, not server ACK.
export async function captureAuthenticatedCurrentPrivateCustodyQuery(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true);
}
// New fixed HTTP-purpose attestation; old QUERY/UNKNOWN bytes stay unchanged.
// This only reads original metadata and never registers/approves a challenge.
export async function captureAuthenticatedSameOriginalRecoveryTarget(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true,true);
}
// The NEW original challenge request has its own fixed path/body/nonce HMAC.
// Its archived QUERY remains historical source evidence, not a new send/ACK.
export async function captureAuthenticatedSameOriginalRecoveryNativeChallenge(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true,false,true);
}
// Current authentication for a READ of the exact archived challenge. Neither
// the original challenge timestamp nor its signature is renewed or replayed.
export async function captureAuthenticatedSameOriginalRecoveryNativeStatus(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true,false,true,true);
}
export async function captureAuthenticatedSameOriginalRecoveryNativePreparation(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true,false,true,true,true);
}
// A separate fixed READ authenticates the complete transport NOW, including
// the exact retained completion bytes. It cannot reuse an ordinary active-
// employee route or turn copied capture JSON into an original owner.
export async function captureAuthenticatedSameOriginalCompletionRead(req,{env=process.env,store,runReadOnlySql,now=new Date()}={}){
 return capturePrivateCustody(req,{env,store,runReadOnlySql,now},true,false,false,false,false,true);
}
async function capturePrivateCustody(req,{env,store,runReadOnlySql,now},currentRead,targetRead=false,nativeChallenge=false,nativeStatus=false,nativePreparation=false,completionRead=false){
 let raw,transportRaw,proofBytes,wire,chunk,currentBytes,challengeRaw,completionBytes;try{
  const path=completionRead?sameOriginalCompletionReadWire.path:nativePreparation?sameOriginalRecoveryNativePreparationPath:nativeStatus?sameOriginalRecoveryNativeStatusPath:nativeChallenge?sameOriginalRecoveryNativeChallengePath:targetRead?sameOriginalRecoveryTargetPath:currentRead?privateCustodyCurrentQueryPath:privateCustodyExchangePath;
  if(req?.method!=='POST'||req?.originalUrl!==path)fail();
  transportRaw=owned(req.scanAuthorityRawBody,completionRead?sameOriginalCompletionReadWire.maxRequestBytes:nativeStatus?1050624:nativeChallenge?786432:currentRead?currentOriginalPrivateQueryReadWire.maxRequestBytes:MAX_REQUEST);
  const completion=completionRead?decodeSameOriginalCompletionRead(transportRaw):null;
  if(completionRead){
   currentBytes=b64(completion.current_original_query_envelope_base64,currentOriginalPrivateQueryReadWire.maxRequestBytes);
   completionBytes=b64(completion.original_completion_arguments_base64,sameOriginalCompletionReadWire.maxOriginalCompletionArgumentBytes);
   // Opaque original DATA remains exact UTF8 here. The fixed SQL owner, not
   // JSON.parse/number round-tripping, validates its application semantics.
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(completionBytes);
   if(!Buffer.from(text,'utf8').equals(completionBytes)||text.charCodeAt(0)===0xfeff)fail();
  }
  const headers=freeze({...req.headers}),body=structuredClone(req.body),status=nativePreparation?decodeSameOriginalRecoveryNativePreparationRead(transportRaw):nativeStatus?decodeSameOriginalRecoveryNativeStatus(transportRaw):null;
  if(nativeStatus)challengeRaw=b64(status.original_challenge_body_base64,786432);
  const challenge=nativeChallenge?decodeSameOriginalRecoveryNativeChallenge(nativeStatus?challengeRaw:transportRaw):null;
  if(nativeChallenge)currentBytes=b64(challenge.current_original_query_envelope_base64,currentOriginalPrivateQueryReadWire.maxRequestBytes);
  const envelope=currentRead?decodeCurrentOriginalPrivateQueryRead(nativeChallenge||completionRead?currentBytes:transportRaw):null;
  raw=currentRead?b64(envelope.original_query_body_base64,MAX_REQUEST):Buffer.from(transportRaw);
  const parsed=parse(raw),{mode,p}=parsed;
  if(currentRead?(mode!=='QUERY'||!isDeepStrictEqual(body,completionRead?completion:nativeStatus?status:nativeChallenge?challenge:envelope)):!isDeepStrictEqual(body,p))fail();
  if(completionRead&&parsed.index!==0)fail();
  if(nativeChallenge&&parsed.index!==0)fail();
  for(const k of ['authorization','origin','x-device-id','x-memphis-app-edition','x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])if(typeof headers[k]!=='string')fail();
  if(headers.origin!=='https://localhost'||headers['x-memphis-app-edition']!=='custodial'||! /^Device \S+$/.test(headers.authorization)||! /^KIOSK_(?:0[2-9]|10)$/.test(headers['x-device-id']))fail();
  const token=credentials.credentialTokenParts(headers.authorization.slice(7));if(!token||!UUID.test(token.credentialId))fail();const clock=new Date(now.getTime());if(!Number.isFinite(clock.getTime()))fail();
  const credentialHash=credentials.tokenHash(token.secret,env),keyId=credentials.deviceCredentialSecretKeyId(env);proofBytes=b64(p.owner_proof_base64,8192);wire=b64(p.original_signed_wire_base64,262144);
  const proof=flat(proofBytes,[...OWNER_FIELDS,'owner_binding_sha256','owner_attestation']);if(proof.schema!==OWNER||proof.credential_id!==token.credentialId||proof.original_generation_id!==p.original_generation_id)fail();
  for(const k of [...OWNER_FIELDS.filter(k=>k.endsWith('sha256')||k==='principal_digest'),'owner_binding_sha256','owner_attestation'])if(!SHA.test(proof[k]))fail();
  if(!equal(proof.owner_binding_sha256,hash(OWNER_FIELDS.map(k=>proof[k]).join('\n')))||!equal(proof.owner_attestation,createHmac('sha256',token.secret).update([OWNER,token.credentialId,proof.owner_binding_sha256].join('\n')).digest('hex')))fail();
  for(const key of ['principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','record_sha256'])if(proof[key]!==p[key])fail();if(proof.original_wire_sha256!==hash(wire))fail();
  decimal(proof.record_bytes,64,privateCustodyRecordSyntaxLimits.record_bytes);for(const k of ['byte_count','record_count','chunk_count'])decimal(proof[k],1,Number.MAX_SAFE_INTEGER);
  const expectedLength=4+4+'custodial.native-private-eight-custody-transport-frame.v1'.length*2+4+proofBytes.length+4+Number(proof.record_bytes)+32;if(expectedLength!==parsed.total)fail();
  const signature=createHmac('sha256',token.secret).update(['custodial-native-private-custody-'+(mode==='WRITE'?'write':'query')+'.v1',token.credentialId,nativeChallenge?p.read_query_id:headers['x-memphis-native-request-id'],currentRead?envelope.original_query_timestamp:headers['x-memphis-native-request-timestamp'],p.purpose_binding_sha256].join('\n')).digest('hex');if(!equal(signature,p.purpose_attestation))fail();
  if(headers['x-memphis-native-request-id']!==(nativeChallenge?challenge.native_challenge_intent_id:mode==='WRITE'?p.attempt_id:p.read_query_id))fail();if(mode==='WRITE'){chunk=b64(p.chunk_base64,CHUNK);if(chunk.length!==parsed.length||!equal(hash(chunk),p.chunk_sha256))fail();}
  if(!store?.findCredential||typeof runReadOnlySql!=='function')fail('native_private_custody_auth_pending',503);
  const device=freeze(structuredClone(await resolveCanonicalDevice({runReadOnlySql,deviceIdentifier:headers['x-device-id']}))),row=freeze(structuredClone(await store.findCredential(token.credentialId)));
  if(!device||device.canonical_device_id!==headers['x-device-id']||device.device_active!==true||device.employee_active!==false||! /^EMP\d+$/i.test(String(device.employee_code||''))||!UUID.test(device.canonical_device_pk||'')||!UUID.test(device.assigned_employee_id||'')||!Number.isSafeInteger(Number(device.assignment_epoch))||Number(device.assignment_epoch)<1)fail();
  if(!row||row.credential_id!==token.credentialId||row.device_id!==device.canonical_device_pk||row.revoked_at||!row.confirmed_at||!equal(row.token_hash,credentialHash))fail();const metadata=row.metadata_json;
  if(metadata!==null&&metadata!==undefined&&Object.getPrototypeOf(metadata)!==Object.prototype)fail();if(metadata&&Object.hasOwn(metadata,'credential_secret_key_id')&&!equal(metadata.credential_secret_key_id,keyId))fail();
  const liveAttestation=verifyNativeDeviceRequestAttestation({method:'POST',originalUrl:path,headers,scanAuthorityRawBody:transportRaw,memphisDevice:device,memphisDeviceCredential:row},{now:clock});
  // Archived signature MATH only. The ordinary live verifier above retains
  // its actual current clock/window and the new fixed read-only path.
  let challengeAttestation=liveAttestation;
  if(nativeStatus){
    const originalHash=hash(challengeRaw),originalTimestamp=status.original_challenge_timestamp;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(originalTimestamp)
      ||!Number.isFinite(Date.parse(originalTimestamp))||new Date(originalTimestamp).toISOString()!==originalTimestamp)fail();
    const archivedSignature=createHmac('sha256',token.secret).update(['custodial-native-request.v1',token.credentialId,
      device.canonical_device_id,'POST',sameOriginalRecoveryNativeChallengePath,originalHash,
      challenge.native_challenge_intent_id,originalTimestamp,'custodial'].join('\n'),'utf8').digest('hex');
    if(!equal(archivedSignature,status.original_challenge_http_attestation))fail();
    challengeAttestation={version:'custodial-native-request.v1',credential_id:token.credentialId,device_id:device.canonical_device_id,
      method:'POST',path:sameOriginalRecoveryNativeChallengePath,body_sha256:originalHash,
      request_id:challenge.native_challenge_intent_id,timestamp:originalTimestamp,signature:archivedSignature};
  }
  const attestation=currentRead?verifyArchivedOriginalPrivateQueryProof({credentialId:token.credentialId,secret:token.secret,
   canonicalDeviceId:device.canonical_device_id,originalBody:raw,readQueryId:p.read_query_id,timestamp:envelope.original_query_timestamp,
   httpSignature:envelope.original_query_http_attestation,purposeBindingSha256:p.purpose_binding_sha256,purposeAttestation:p.purpose_attestation}):liveAttestation;
  const context=await one(runReadOnlySql,`select public.custodial_v13_read_separation_context('${device.canonical_device_pk}'::uuid,'${token.credentialId}'::uuid) as context`,'context');
  if(!exact(context,CONTEXT)||context.device_id!==device.canonical_device_pk||context.credential_id!==token.credentialId||context.employee_id!==device.assigned_employee_id||context.canonical_device_id!==device.canonical_device_id||context.assignment_epoch!==Number(device.assignment_epoch)||context.schema!=='custodial.separation-context.v1'||context.purpose!=='SEPARATION_STATUS_ONLY'||context.state!=='PENDING_RECONCILIATION'||context.new_work_allowed!==false||context.phone_released!==false||!UUID.test(context.separation_id||''))fail();
  const generation=await one(runReadOnlySql,`select public.custodial_v14_read_separation_generation('${context.device_id}'::uuid,'${context.credential_id}'::uuid,'${context.separation_id}'::uuid,'${p.original_generation_id}'::uuid,'${p.principal_digest}'::text) as original_generation`,'original_generation'),
    binding=verifyNativeProtectedSnapshotOriginalGeneration(wire,{separationContext:context,originalGeneration:generation,credentialToken:token.credentialId+'.'+token.secret});
  if(nativeChallenge){
    // Permission preparation cannot adopt missing legacy issuer provenance or
    // a caller-declared server mapping. These are still observation checks;
    // the intended transaction must revalidate this exact original again.
    if(typeof metadata?.credential_secret_key_id!=='string'||metadata.credential_secret_key_id!==keyId)fail();
    const expected={operation_id:p.operation_id,separation_id:context.separation_id,
      separation_authority_revision:String(context.authority_revision),canonical_device_pk:context.device_id,
      canonical_device_id:context.canonical_device_id,employee_id:context.employee_id,credential_id:token.credentialId,
      assignment_epoch:String(context.assignment_epoch),original_generation_id:p.original_generation_id,
      original_credential_secret_key_id:keyId,principal_digest:p.principal_digest,engine_revision:p.engine_revision,
      original_wire_sha256:hash(wire),original_frozen_work_sha256:p.original_frozen_work_sha256,
      capsule_sha256:proof.capsule_sha256,record_sha256:p.record_sha256,frame_sha256:p.frame_sha256,plan_sha256:p.plan_sha256,
      aad_binding_sha256:proof.aad_binding_sha256,source_capture_sha256:proof.source_capture_sha256,
      values_sha256:proof.values_sha256,semantic_join_sha256:proof.semantic_join_sha256,layout_sha256:proof.layout_sha256};
    if(!isDeepStrictEqual(challenge.original_target,expected))fail();
  }
  if(binding.principal_digest!==p.principal_digest||!transportRaw.equals(req.scanAuthorityRawBody)||!isDeepStrictEqual(headers,req.headers)||!isDeepStrictEqual(body,req.body))fail();
  const result=freeze({schema:'custodial.private-custody-authenticated-request-observation.v1',state:'AUTH_AT_OBSERVATION_ONLY_NOT_TRANSACTION_CUSTODY_OR_ACK',mode,
    operation_id:p.operation_id,original_generation_id:p.original_generation_id,principal_digest:p.principal_digest,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,
    native_request_id:attestation.request_id,request_body_sha256:attestation.body_sha256,chunk_index:parsed.index,chunk_count:parsed.count,frame_bytes:parsed.total,
    purpose_and_HTTP_HMAC_verified:true,current_observed_auth_and_original_generation_verified:true,current_transaction_fence:false,
    frame_complete_syntax_verified:false,original_device_key_GCM_server_verified:false,raw_namespace_values_recovered:false,
    writer_authority:false,durable_retention:false,current_server_readback:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
  captures.set(result,{p,parsed,raw:Buffer.from(raw),proof:Buffer.from(proofBytes),wire:Buffer.from(wire),chunk:chunk?Buffer.from(chunk):null,
    device:context.device_id,credential:token.credentialId,credentialHash,keyId,context,binding,currentRead,targetRead,
    nativeStatus,nativePreparation,completionRead,
    completionArguments:completionRead?Buffer.from(completionBytes):null,
    nativeChallenge:challenge?{body:challenge,raw:Buffer.from(nativeStatus?challengeRaw:transportRaw),request_id:challengeAttestation.request_id,
      body_sha256:challengeAttestation.body_sha256,timestamp:challengeAttestation.timestamp,attestation_digest:hash(JSON.stringify([
        challengeAttestation.version,challengeAttestation.credential_id,challengeAttestation.device_id,challengeAttestation.method,challengeAttestation.path,
        challengeAttestation.body_sha256,challengeAttestation.request_id,challengeAttestation.timestamp,challengeAttestation.signature]))}:null,
    currentReadBinding:currentRead?freeze({body_sha256:liveAttestation.body_sha256,timestamp:liveAttestation.timestamp,
     original_query_unknown_record_sha256:envelope.original_query_unknown_record_sha256}):null,
    attestation_digest:hash(JSON.stringify([attestation.version,attestation.credential_id,attestation.device_id,attestation.method,attestation.path,attestation.body_sha256,attestation.request_id,attestation.timestamp,attestation.signature]))});return result;
 }catch(e){if(e?.status===503)throw e;fail();}finally{for(const b of [raw,transportRaw,proofBytes,wire,chunk,currentBytes,challengeRaw,completionBytes])b?.fill(0);}
}
export const isAuthenticatedPrivateCustodyExchangeCapture=value=>captures.has(value);
export const isAuthenticatedSameOriginalRecoveryNativeChallengeCapture=value=>captures.get(value)?.nativeStatus===false&&captures.get(value)?.nativeChallenge!==null&&captures.get(value)?.nativeChallenge!==undefined;
export const isAuthenticatedSameOriginalRecoveryNativeStatusCapture=value=>captures.get(value)?.nativeStatus===true&&captures.get(value)?.nativePreparation===false&&captures.get(value)?.nativeChallenge!==null;
export const isAuthenticatedSameOriginalRecoveryNativePreparationCapture=value=>captures.get(value)?.nativeStatus===true&&captures.get(value)?.nativePreparation===true&&captures.get(value)?.nativeChallenge!==null;
export const isAuthenticatedSameOriginalCompletionReadCapture=value=>captures.get(value)?.completionRead===true;
// The original argument DATA is only exported to the fixed server reader.
// All SQL parameters come from this exact private capture, never a caller's
// request/receipt object or a selectable query/role.
export function inspectAuthenticatedSameOriginalCompletionRead(capture){
 const entry=captures.get(capture);
 if(!entry||entry.completionRead!==true||entry.currentRead!==true||entry.parsed.mode!=='QUERY'
  ||entry.parsed.index!==0||!entry.completionArguments?.length)fail('same_original_completion_capture_unbound',403);
 const p=entry.p,t=target(entry,capture),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(entry.completionArguments);
 return Object.freeze({capture,observation_only:true,transaction_authority:false,
  original_completion_arguments_utf8:text,original_completion_arguments_sha256:hash(entry.completionArguments),
  original_principal:Object.freeze({device_id:entry.context.device_id,canonical_device_id:entry.context.canonical_device_id,
   employee_id:entry.context.employee_id,credential_id:entry.credential,assignment_epoch:String(entry.context.assignment_epoch)}),
  rpc_parameters:Object.freeze({p_operation:p.operation_id,p_device:entry.device,p_credential:entry.credential,
   p_credential_hash:entry.credentialHash,p_credential_key_id:entry.keyId,p_generation:p.original_generation_id,
   p_chunk_index:entry.parsed.index,p_native_request:t.request,p_request_sha256:t.body,p_attestation_digest:t.attestation,
   p_original_completion_utf8:text})});
}
// Fixed private server adapter binding ONLY. Its observation cannot replace
// the current transaction or be reconstructed from copied JSON/body flags.
export function inspectAuthenticatedSameOriginalRecoveryNativeChallenge(capture){
 return inspectNativeChallengeBinding(capture,false);
}
export function inspectAuthenticatedSameOriginalRecoveryNativeStatus(capture){
 return inspectNativeChallengeBinding(capture,true);
}
export function inspectAuthenticatedSameOriginalRecoveryNativePreparation(capture){
 return inspectNativeChallengeBinding(capture,true,true);
}
function inspectNativeChallengeBinding(capture,status,preparation=false){
 const entry=captures.get(capture),n=entry?.nativeChallenge;
 if(!n||entry.nativeStatus!==status||entry.nativePreparation!==preparation||entry.parsed.mode!=='QUERY'||entry.parsed.index!==0)fail('same_original_recovery_native_capture_unbound',403);
 const t=target(entry,capture),p=entry.p;
 return Object.freeze({capture,observation_only:true,transaction_authority:false,
  original_request_utf8:n.raw.toString('utf8'),original_target:n.body.original_target,
  native_challenge_intent_id:n.body.native_challenge_intent_id,
  native_challenge_intent_record_sha256:n.body.native_challenge_intent_record_sha256,
  rpc_parameters:Object.freeze({p_operation:p.operation_id,p_device:entry.device,p_credential:entry.credential,
   p_credential_hash:entry.credentialHash,p_credential_key_id:entry.keyId,p_generation:p.original_generation_id,
   p_chunk_index:entry.parsed.index,p_original_write_request:t.request,p_original_write_body_sha256:t.body,
   p_original_write_attestation_digest:t.attestation,p_native_request:n.request_id,p_native_request_timestamp:n.timestamp,
   p_native_request_body_sha256:n.body_sha256,p_native_attestation_digest:n.attestation_digest,
   p_original_utf8:n.raw.toString('utf8')})});
}
export function closeAuthenticatedPrivateCustodyExchangeCapture(value){const entry=captures.get(value);if(!entry)return;for(const b of [entry.raw,entry.proof,entry.wire,entry.chunk,entry.nativeChallenge?.raw,entry.completionArguments])b?.fill(0);captures.delete(value);}

const READBACK=['schema','state','operation_id','generation_id','chunk_index','native_request_id','request_body_sha256','attestation_digest','frame_sha256','record_sha256','plan_sha256','chunk_sha256','chunk_bytes','received_at',
 'frame_complete_syntax_verified','inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'];

// Private, source-owned SQL composition only. The ordinary reader keeps its
// existing defaults. No HTTP/request option, environment fallback or returned
// acceptance field can select a query, role or larger response limit here.
const MAX_FRAME_CHUNKS=Math.ceil(MAX_FRAME/CHUNK),MAX_FRAME_BASE64_BYTES=4*Math.ceil(MAX_FRAME/3),
 MAX_FRAME_SQL_METADATA_BYTES=Buffer.byteLength(JSON.stringify({complete_private_frame:{
  schema:'custodial.private-custody-complete-frame-SQL-input.v1',state:'COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY',
  readback:{schema:'custodial.private-custody-chunk-readback.v1',state:'OPAQUE_CHUNK_READ_ONLY_PENDING_RECONCILIATION',
   operation_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',generation_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',chunk_index:MAX_FRAME_CHUNKS-1,
   native_request_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',request_body_sha256:'f'.repeat(64),attestation_digest:'f'.repeat(64),
   frame_sha256:'f'.repeat(64),record_sha256:'f'.repeat(64),plan_sha256:'f'.repeat(64),chunk_sha256:'f'.repeat(64),chunk_bytes:CHUNK,
   received_at:'9999-12-31T23:59:59.999999Z',frame_complete_syntax_verified:false,inventory_acknowledged:false,work_accepted:false,
   new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false},
  frame_bytes:MAX_FRAME,frame_sha256:'f'.repeat(64),record_sha256:'f'.repeat(64),plan_sha256:'f'.repeat(64),
  chunk_count:MAX_FRAME_CHUNKS,received_chunk_count:MAX_FRAME_CHUNKS,frame_base64:''}}),'utf8'),
 // Normal read.js counts [] (2 bytes), JSON row bytes, and one row separator.
 MAX_FRAME_SQL_RESPONSE_BYTES=MAX_FRAME_BASE64_BYTES+MAX_FRAME_SQL_METADATA_BYTES+3,
 COMPLETE_FRAME_RPC='custodial_private_custody_v1_read_complete_frame',
 sqlUuid="'("+UUID.source.slice(1,-1)+")'::uuid",sqlHash="'("+SHA.source.slice(1,-1)+")'::text",
 completeFrameSql=new RegExp('^select public\\.'+COMPLETE_FRAME_RPC+'\\('+[
  "'("+OP.source.slice(1,-1)+")'::uuid",sqlUuid,sqlUuid,sqlHash,sqlHash,sqlUuid,
  '(0|[1-9][0-9]{0,15})::integer',sqlUuid,sqlHash,sqlHash].join(',')+'\\) as complete_private_frame$');
export const privateCustodyFixedSqlReadLimits=Object.freeze({maxRows:1,maxResponseBytes:MAX_FRAME_SQL_RESPONSE_BYTES,
 maxFrameBytes:MAX_FRAME,maxFrameBase64Bytes:MAX_FRAME_BASE64_BYTES,metadataRowBytes:MAX_FRAME_SQL_METADATA_BYTES});

/** Main supplies the existing normal envelope runner and unchanged ordinary
 * rows reader. This is not a database client, auth grant or HTTP response API.
 * Full original capture/frame/record/readback checks remain mandatory below. */
export function createPrivateCustodyFixedReadOnlySql({runSupabaseReadOnlySql,runReadOnlySql}={}){
 if(typeof runSupabaseReadOnlySql!=='function'||typeof runReadOnlySql!=='function'
  ||!Number.isSafeInteger(MAX_FRAME_SQL_RESPONSE_BYTES)||MAX_FRAME_SQL_RESPONSE_BYTES>100_000_000)
  throw new TypeError('Explicit normal and ordinary private custody readers within the existing hard cap are required');
 return Object.freeze(async function privateCustodyFixedReadOnlySql(sql){
  if(typeof sql!=='string')fail('native_private_custody_complete_frame_pending',503);
  const matched=completeFrameSql.exec(sql);
  if(!matched){
   if(sql.toLowerCase().includes(COMPLETE_FRAME_RPC))fail('native_private_custody_complete_frame_pending',503);
   return runReadOnlySql(sql);
  }
  if(matched[0]!==sql||!Number.isSafeInteger(Number(matched[7]))||Number(matched[7])>=MAX_FRAME_CHUNKS)
   fail('native_private_custody_complete_frame_pending',503);
  try{
   const response=await runSupabaseReadOnlySql(Object.freeze({sql,maxRows:1,maxResponseBytes:MAX_FRAME_SQL_RESPONSE_BYTES}));
   if(!response||response.ok!==true||Object.hasOwn(response,'error')||response.wrapped!==true
    ||response.response_truncated!==false||response.row_limit_truncated!==false
    ||response.rowCount!==1||response.originalRowCount!==1||response.omitted_oversized_rows!==0
    ||response.first_oversized_row_bytes!==undefined||response.omitted_oversized_value_bytes!==undefined
    ||response.limits?.max_rows!==1||response.limits?.max_response_bytes!==MAX_FRAME_SQL_RESPONSE_BYTES
    ||response.limits?.hard_caps?.max_response_bytes!==100_000_000
    ||!Number.isSafeInteger(response.response_bytes)||response.response_bytes<3||response.response_bytes>MAX_FRAME_SQL_RESPONSE_BYTES
    ||!Array.isArray(response.rows)||response.rows.length!==1||!exact(response.rows[0],['complete_private_frame']))
    fail('native_private_custody_complete_frame_pending',503);
   // Refuse a dishonest/unsupported envelope as well as actual truncation.
   // This is a byte boundary only, never proof of custody, identity or ACK.
   const bytes=Buffer.byteLength(JSON.stringify(response.rows),'utf8')+1;
   if(bytes!==response.response_bytes||bytes>MAX_FRAME_SQL_RESPONSE_BYTES)fail('native_private_custody_complete_frame_pending',503);
   return response.rows;
  }catch{fail('native_private_custody_complete_frame_pending',503);}
 });
}

function target(entry,capture){return entry.parsed.mode==='WRITE'?{request:capture.native_request_id,body:capture.request_body_sha256,attestation:entry.attestation_digest}
 :{request:entry.p.target_native_request_id,body:entry.p.target_request_body_sha256,attestation:entry.p.target_attestation_digest};}
function validateReadback(value,entry,capture){if(!exact(value,READBACK))fail('native_private_custody_readback_pending',503);const t=target(entry,capture),p=entry.p;
 const expected={schema:'custodial.private-custody-chunk-readback.v1',state:'OPAQUE_CHUNK_READ_ONLY_PENDING_RECONCILIATION',operation_id:p.operation_id,generation_id:p.original_generation_id,chunk_index:entry.parsed.index,
  native_request_id:t.request,request_body_sha256:t.body,attestation_digest:t.attestation,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,chunk_sha256:p.chunk_sha256,chunk_bytes:entry.parsed.length,
  frame_complete_syntax_verified:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false};
 for(const [key,wanted]of Object.entries(expected))if(!isDeepStrictEqual(value[key],wanted))fail('native_private_custody_readback_mismatch',503);
 if(typeof value.received_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.received_at)||!Number.isFinite(Date.parse(value.received_at)))fail('native_private_custody_readback_mismatch',503);return freeze(structuredClone(value));}
export async function readAuthenticatedPrivateCustodyExchange(capture,{runReadOnlySql}={}){
 const entry=captures.get(capture);if(!entry||entry.targetRead===true||entry.nativeChallenge||typeof runReadOnlySql!=='function')fail('native_private_custody_readback_pending',503);const t=target(entry,capture),p=entry.p;
 // All interpolated values are fixed canonical UUID/hash/int fields validated
 // before awaits. Neither a callback-selected RPC name nor arbitrary SQL is exposed.
 const sql=`select public.custodial_private_custody_v1_read_chunk('${p.operation_id}'::uuid,'${entry.device}'::uuid,'${entry.credential}'::uuid,'${entry.credentialHash}'::text,'${entry.keyId}'::text,'${p.original_generation_id}'::uuid,${entry.parsed.index}::integer,'${t.request}'::uuid,'${t.body}'::text,'${t.attestation}'::text) as private_custody`;
 let rows;try{rows=await runReadOnlySql(sql);}catch{fail('native_private_custody_readback_pending',503);}if(!captures.has(capture)||!Array.isArray(rows)||rows.length!==1||!exact(rows[0],['private_custody']))fail('native_private_custody_readback_pending',503);
 if(rows[0].private_custody===null)return freeze({schema:'custodial.private-custody-read-result.v1',state:'NO_MATCHING_ORIGINAL_WRITE_READBACK',current_server_readback:false,
  write_outcome_unresolved:true,resend_allowed:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
 return freeze({schema:'custodial.private-custody-read-result.v1',state:'EXACT_OPAQUE_CHUNK_READBACK_ONLY_NOT_SEMANTIC_ACK',readback:validateReadback(rows[0].private_custody,entry,capture),
  current_server_readback:true,write_outcome_unresolved:false,resend_allowed:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
}
export async function recordAuthenticatedPrivateCustodyExchange(capture,{db,runReadOnlySql}={}){
 const entry=captures.get(capture);if(!entry||entry.parsed.mode!=='WRITE'||capture.mode!=='WRITE'||consumedWrites.has(capture)||!db||typeof db.rpc!=='function'||typeof runReadOnlySql!=='function')fail('native_private_custody_write_pending',503);
 consumedWrites.add(capture); // one write call per closed authenticated request; failure never grants retry.
 const p=entry.p,args=Object.freeze({p_operation:p.operation_id,p_device:entry.device,p_credential:entry.credential,p_credential_hash:entry.credentialHash,p_credential_key_id:entry.keyId,
  p_generation:p.original_generation_id,p_native_request:capture.native_request_id,p_attestation_digest:entry.attestation_digest,p_request_base64:entry.raw.toString('base64'),p_binding:entry.binding,
  p_owner_proof:JSON.parse(entry.proof.toString('utf8'))});
 let receipt=null,uncertain=true;try{const r=await db.rpc('custodial_private_custody_v1_retain_chunk',args);if(r?.error&&['42501','22023','23505','23514','40001'].includes(r.error.code))fail('native_private_custody_write_denied_or_conflict',r.error.code==='42501'?403:409);
  if(!r?.error&&r?.data){receipt=structuredClone(r.data);uncertain=false;}}
 catch(e){if([403,409].includes(e?.status))throw e;/* ambiguous write: exactly one fixed READ, NEVER another write */}
 if(!captures.has(capture))fail('native_private_custody_closed_after_write',503);const read=await readAuthenticatedPrivateCustodyExchange(capture,{runReadOnlySql});
 if(!read.current_server_readback)fail('native_private_custody_write_outcome_unresolved',503);
 if(receipt){const expected={schema:'custodial.private-custody-chunk-receipt.v1',state:'OPAQUE_CHUNK_RETAINED_ONLY_PENDING_RECONCILIATION',operation_id:p.operation_id,generation_id:p.original_generation_id,
  chunk_index:entry.parsed.index,native_request_id:capture.native_request_id,request_body_sha256:capture.request_body_sha256,attestation_digest:entry.attestation_digest,frame_sha256:p.frame_sha256,plan_sha256:p.plan_sha256,chunk_sha256:p.chunk_sha256,
  inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false};
  if(!exact(receipt,[...Object.keys(expected),'replayed'])||typeof receipt.replayed!=='boolean')fail('native_private_custody_write_receipt_invalid',503);for(const [key,wanted]of Object.entries(expected))if(!isDeepStrictEqual(receipt[key],wanted))fail('native_private_custody_write_receipt_invalid',503);}
 return freeze({schema:'custodial.private-custody-write-result.v1',state:'OPAQUE_CHUNK_COMMIT_AND_EXACT_READBACK_ONLY_NOT_SEMANTIC_ACK',current_transaction_private_writer_called:true,
  commit_readback_confirmed:true,original_request_readback_confirmed:true,ambiguous_write_reconciled:uncertain,readback:read.readback,
  frame_complete_syntax_verified:false,inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
}

// Server-only explicit complete-frame qualification seam. The existing
// chunk HTTP reply remains byte/schema compatible and is NOT promoted. A
// missing new fixed RPC fails pending; no fallback, writer, retry or raw export.
export async function readAuthenticatedPrivateCustodyCompleteFrame(capture,{runReadOnlySql}={}){
 return readPrivateCustodyCompleteFrame(capture,runReadOnlySql,false);
}
export async function readAuthenticatedSameOriginalRecoveryTarget(capture,{runReadOnlySql}={}) {
 const entry=captures.get(capture);
 if(!entry||entry.targetRead!==true||entry.currentRead!==true||entry.parsed.mode!=='QUERY'||typeof runReadOnlySql!=='function')
  fail('same_original_recovery_target_pending',503);
 const p=entry.p,t=target(entry,capture);
 const sql=`select public.custodial_same_original_preparation_target_v1('${p.operation_id}'::uuid,'${entry.device}'::uuid,'${entry.credential}'::uuid,'${entry.credentialHash}'::text,'${entry.keyId}'::text,'${p.original_generation_id}'::uuid,${entry.parsed.index}::integer,'${t.request}'::uuid,'${t.body}'::text,'${t.attestation}'::text) as original_target`;
 const raw=await one(runReadOnlySql,sql,'original_target');
 if(!captures.has(capture)||!exact(raw,['schema','state','original_target','original_target_sha256','original_write_readback','limits'])
  ||raw.schema!=='custodial.same-original-recovery-target-SQL.v1'||raw.state!=='ORIGINAL_TARGET_DESCRIPTOR_ONLY'
  ||!isDeepStrictEqual(raw.limits,recoveryDeniedEffects))fail('same_original_recovery_target_mismatch',503);
 const v=validateRecoveryOriginalTarget(raw.original_target);
 if(raw.original_target_sha256!==recoveryDocumentSha256('target',v))fail('same_original_recovery_target_mismatch',503);
 const proof=JSON.parse(entry.proof.toString('utf8'));
 const expected={operation_id:p.operation_id,separation_id:entry.context.separation_id,
  separation_authority_revision:String(entry.context.authority_revision),canonical_device_pk:entry.device,
  canonical_device_id:entry.context.canonical_device_id,employee_id:entry.context.employee_id,credential_id:entry.credential,
  assignment_epoch:String(entry.context.assignment_epoch),original_generation_id:p.original_generation_id,
  original_credential_secret_key_id:entry.keyId,principal_digest:p.principal_digest,engine_revision:p.engine_revision,
  original_wire_sha256:hash(entry.wire),original_frozen_work_sha256:p.original_frozen_work_sha256,
  capsule_sha256:proof.capsule_sha256,record_sha256:p.record_sha256,frame_sha256:p.frame_sha256,plan_sha256:p.plan_sha256,
  aad_binding_sha256:proof.aad_binding_sha256,source_capture_sha256:proof.source_capture_sha256,
  values_sha256:proof.values_sha256,semantic_join_sha256:proof.semantic_join_sha256,layout_sha256:proof.layout_sha256};
 if(!isDeepStrictEqual(v,expected))fail('same_original_recovery_target_mismatch',503);
 validateReadback(raw.original_write_readback,entry,capture);
 return freeze({schema:'custodial.same-original-recovery-target-observation.v1',state:'ORIGINAL_TARGET_DESCRIPTOR_ONLY',
  original_target:v,original_target_sha256:raw.original_target_sha256,original_read_query_id:p.read_query_id,
  original_query_body_sha256:hash(entry.raw),original_query_unknown_record_sha256:entry.currentReadBinding.original_query_unknown_record_sha256,
  current_request_body_sha256:entry.currentReadBinding.body_sha256,limits:recoveryDeniedEffects});
}
// UNMOUNTED bounded opaque reply contract ONLY. A future protected native
// transport must explicitly verify this new schema; the old exact22 reply,
// route and response limit are unchanged. Only the privately captured original
// QUERY selects its own fixed chunk; no caller offset/range/SQL/path, raw-value
// export, new query identity, write, retry, semantic ACK or key authority.
export async function readAuthenticatedPrivateCustodyReturnedPiece(capture,{runReadOnlySql}={}){
 const entry=captures.get(capture);
 if(!entry||entry.parsed.mode!=='QUERY'||capture.mode!=='QUERY'||typeof runReadOnlySql!=='function'||consumedReturnedPieces.has(capture))
  fail('native_private_custody_returned_piece_pending',503);
 consumedReturnedPieces.add(capture); // a failed/ambiguous read never mints a retry or replacement query.
 return readPrivateCustodyCompleteFrame(capture,runReadOnlySql,true);
}
async function readPrivateCustodyCompleteFrame(capture,runReadOnlySql,returnedPiece){
 const entry=captures.get(capture);if(!entry||entry.targetRead===true||entry.nativeChallenge||typeof runReadOnlySql!=='function')fail('native_private_custody_complete_frame_pending',503);
 const p=entry.p,t=target(entry,capture),sql=`select public.custodial_private_custody_v1_read_complete_frame('${p.operation_id}'::uuid,'${entry.device}'::uuid,'${entry.credential}'::uuid,'${entry.credentialHash}'::text,'${entry.keyId}'::text,'${p.original_generation_id}'::uuid,${entry.parsed.index}::integer,'${t.request}'::uuid,'${t.body}'::text,'${t.attestation}'::text) as complete_private_frame`;
 let rows,frame;
 try{
  try{rows=await runReadOnlySql(sql);}catch{fail('native_private_custody_complete_frame_pending',503);}
  if(!captures.has(capture)||!Array.isArray(rows)||rows.length!==1||!exact(rows[0],['complete_private_frame']))fail('native_private_custody_complete_frame_pending',503);
  const v=rows[0].complete_private_frame;
  const noAuthority={inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false};
  if(v===null){if(returnedPiece)fail('native_private_custody_returned_piece_pending',503);return freeze({schema:'custodial.private-custody-complete-frame-read-result.v1',state:'NO_MATCHING_ORIGINAL_WRITE_READBACK',
   current_SQL_snapshot_frame_readback:false,frame_complete_syntax_verified:false,...noAuthority});}
  if(!exact(v,['schema','state','readback','frame_bytes','frame_sha256','record_sha256','plan_sha256','chunk_count','received_chunk_count','frame_base64'])
   ||v.schema!=='custodial.private-custody-complete-frame-SQL-input.v1'||v.frame_bytes!==entry.parsed.total||v.frame_sha256!==p.frame_sha256
   ||v.record_sha256!==p.record_sha256||v.plan_sha256!==p.plan_sha256||v.chunk_count!==entry.parsed.count
   ||!Number.isSafeInteger(v.received_chunk_count)||v.received_chunk_count<1||v.received_chunk_count>entry.parsed.count)
   fail('native_private_custody_complete_frame_mismatch',503);
  const readback=validateReadback(v.readback,entry,capture);
  if(v.received_chunk_count<entry.parsed.count){if(v.state!=='INCOMPLETE_ORIGINAL_OPAQUE_FRAME'||v.frame_base64!==null)fail('native_private_custody_complete_frame_mismatch',503);
   if(returnedPiece)fail('native_private_custody_returned_piece_pending',503);
   return freeze({schema:'custodial.private-custody-complete-frame-read-result.v1',state:'INCOMPLETE_ORIGINAL_OPAQUE_FRAME',operation_id:p.operation_id,
    generation_id:p.original_generation_id,chunk_count:v.chunk_count,received_chunk_count:v.received_chunk_count,readback,
    current_SQL_snapshot_frame_readback:false,frame_complete_syntax_verified:false,...noAuthority});}
  if(v.state!=='COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY'||typeof v.frame_base64!=='string'||v.frame_base64.length>4*Math.ceil(entry.parsed.total/3))
   fail('native_private_custody_complete_frame_mismatch',503);
  frame=b64(v.frame_base64,MAX_FRAME);
  if(frame.length!==entry.parsed.total||hash(frame)!==p.frame_sha256)fail('native_private_custody_complete_frame_mismatch',503);
  const syntax=inspectPrivateCustodyTransportFrameOriginalBinding(frame,entry.proof,flat(entry.proof,[...OWNER_FIELDS,'owner_binding_sha256','owner_attestation']));
  if(syntax.record_sha256!==p.record_sha256||!captures.has(capture))fail('native_private_custody_complete_frame_mismatch',503);
  if(returnedPiece){
   let piece;try{
    piece=Buffer.from(frame.subarray(entry.parsed.index*CHUNK,entry.parsed.index*CHUNK+entry.parsed.length));
    if(piece.length!==entry.parsed.length||hash(piece)!==p.chunk_sha256||!captures.has(capture))fail('native_private_custody_returned_piece_mismatch',503);
    const response=freeze({schema:'custodial.private-custody-original-frame-piece.v1',state:'CURRENT_SQL_ORIGINAL_ENCRYPTED_PIECE_NOT_NATIVE_OR_SEMANTIC_ACK',
     operation_id:p.operation_id,generation_id:p.original_generation_id,principal_digest:p.principal_digest,engine_revision:Number(p.engine_revision),original_frozen_work_sha256:p.original_frozen_work_sha256,
     frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,frame_bytes:frame.length,chunk_count:entry.parsed.count,chunk_index:entry.parsed.index,
     offset:entry.parsed.index*CHUNK,chunk_bytes:piece.length,chunk_sha256:p.chunk_sha256,encrypted_piece_base64:piece.toString('base64'),readback,
     query_witness:{native_request_id:capture.native_request_id,request_body_sha256:capture.request_body_sha256,attestation_digest:entry.attestation_digest,purpose_binding_sha256:p.purpose_binding_sha256,
      target_prepared_record_sha256:p.target_prepared_record_sha256,target_unknown_record_sha256:p.target_unknown_record_sha256},
     current_SQL_snapshot_frame_readback:true,frame_complete_syntax_verified:true,exact_authenticated_original_owner_proof_bytes_match:true,
     original_device_key_GCM_server_verified:false,raw_namespace_values_recovered:false,complete_namespace_inventory:false,all_writer_durable_freeze_or_ABA_guard:false,
     read_snapshot_is_not_future_acceptance_or_transaction_write_authority:true,...noAuthority});
    if(Buffer.byteLength(JSON.stringify(response),'utf8')>262144||!captures.has(capture))fail('native_private_custody_returned_piece_mismatch',503);return response;
   }finally{piece?.fill(0);}
  }
  return freeze({schema:'custodial.private-custody-complete-frame-read-result.v1',state:'CURRENT_SQL_COMPLETE_ORIGINAL_OPAQUE_FRAME_SYNTAX_NOT_SEMANTIC_ACK',
   operation_id:p.operation_id,generation_id:p.original_generation_id,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,
   frame_bytes:frame.length,chunk_count:v.chunk_count,received_chunk_count:v.received_chunk_count,readback,
   current_SQL_snapshot_frame_readback:true,frame_complete_syntax_verified:true,exact_authenticated_original_owner_proof_bytes_match:true,
   original_device_key_GCM_server_verified:false,raw_namespace_values_recovered:false,all_writer_durable_freeze_or_ABA_guard:false,
   complete_namespace_inventory:false,read_snapshot_is_not_future_acceptance_or_transaction_write_authority:true,...noAuthority});
 }finally{frame?.fill(0);rows=null;/* JS strings are released, not guaranteed erased. Never log raw frame/piece/credentials; only the new explicit contract returns one encrypted piece. */}
}
