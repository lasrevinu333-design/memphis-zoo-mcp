import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inspectPrivateCustodyRecordSyntax,privateCustodyRecordSyntaxLimits} from './native-private-custody-record.js';
import {captureAuthenticatedNativeEvidence,originalRetainedRecordDigestAuthority,retainedNativeIntakePath} from './native-retained-wire-intake.js';
import {deviceCredentialInternals as credentials} from './auth/device-credential-auth.js';

// UNMOUNTED observation ONLY. The fixed existing normal-auth original WORK
// frame supplies identity, not an all8 custody operation or retention witness.
// A separate purpose HMAC binds the actual opaque record and all8 native owner.
// No RPC/writer/route/receipt, no token/ciphertext export or promotion. Even
// this brand is NEVER writer authority: a later mounted writer needs its own
// current-auth/transaction fence and original durable custody identities.
const SCHEMA='custodial-native-private-custody-owner-proof.v1';
const FIELDS=['schema','credential_id','original_wire_sha256','record_sha256','record_bytes','capsule_sha256','aad_binding_sha256',
 'source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256','principal_digest','original_generation_id',
 'original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'];
const KEYS=[...FIELDS,'owner_binding_sha256','owner_attestation'],SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX=8192,hash=x=>createHash('sha256').update(x).digest('hex'),observations=new WeakSet();
const fail=()=>{throw Object.assign(new Error('native_private_custody_owner_proof_invalid'),{code:'native_private_custody_owner_proof_invalid',status:403});};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&SHA.test(a)&&SHA.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function copyBytes(input,max){if(!Buffer.isBuffer(input)||Object.getPrototypeOf(input)!==Buffer.prototype||input.buffer instanceof SharedArrayBuffer||!input.length||input.length>max)fail();return Buffer.from(input);}
function parse(input){
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(input);let at=0;const rows=[],seen=new Set();
 const ws=()=>{while(/[ \t\r\n]/.test(text[at]??'!'))at++;};
 const string=()=>{ws();if(text[at++]!=='"')fail();const start=at-1;while(at<text.length){const c=text[at++];if(c==='\\'){at++;continue;}if(c==='"')return JSON.parse(text.slice(start,at));}fail();};
 ws();if(text[at++]!=='{')fail();while(true){const k=string();if(!KEYS.includes(k)||seen.has(k))fail();seen.add(k);ws();if(text[at++]!==':')fail();rows.push([k,string()]);ws();const c=text[at++];if(c==='}')break;if(c!==','||rows.length>=KEYS.length)fail();}
 ws();if(at!==text.length||rows.length!==KEYS.length)fail();const p=Object.fromEntries(rows);
 if(p.schema!==SCHEMA||!UUID.test(p.credential_id)||!UUID.test(p.original_generation_id))fail();
 for(const k of KEYS.filter(k=>k.endsWith('sha256')||k==='principal_digest'||k==='owner_attestation'))if(!SHA.test(p[k]))fail();
 for(const k of ['record_bytes','engine_revision','byte_count','record_count','chunk_count'])if(!/^(?:0|[1-9][0-9]*)$/.test(p[k])||!Number.isSafeInteger(Number(p[k])))fail();
 if(!same(p.owner_binding_sha256,hash(FIELDS.map(k=>p[k]).join('\n'))))fail();return freeze(p);
}
export async function observeAuthenticatedPrivateCustodyOwner(req,opaqueRecord,ownerProofBytes,options={}){
 let record,proofBytes,raw;
 try{
  // Immutable owned snapshots BEFORE any await; no request header reference,
  // raw email, plaintext namespace rows or credential is retained in output.
  record=copyBytes(opaqueRecord,privateCustodyRecordSyntaxLimits.record_bytes);proofBytes=copyBytes(ownerProofBytes,MAX);
  if(req?.method!=='POST'||req?.originalUrl!==retainedNativeIntakePath)fail();raw=copyBytes(req.scanAuthorityRawBody,393216);
  const captured={method:'POST',originalUrl:retainedNativeIntakePath,headers:Object.freeze({...req.headers}),scanAuthorityRawBody:raw,body:structuredClone(req.body)};
  const p=parse(proofBytes),syntax=inspectPrivateCustodyRecordSyntax(record);
  for(const k of ['record_sha256','record_bytes','capsule_sha256','aad_binding_sha256','source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256',
   'principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'])if(p[k]!==String(syntax[k]))fail();
  const first=await captureAuthenticatedNativeEvidence(captured,options);
  // Calling the owning brand reader refuses fabricated/copy JSON authority.
  originalRetainedRecordDigestAuthority(first);
  if(p.credential_id!==first.credential_id||p.original_generation_id!==first.generation_id||!same(p.principal_digest,first.verified_binding.principal_digest)
   ||!same(p.original_wire_sha256,first.wire_sha256))fail();
  const token=credentials.credentialTokenParts(captured.headers.authorization.slice(7));if(!token||token.credentialId!==p.credential_id)fail();
  const expected=createHmac('sha256',token.secret).update([SCHEMA,p.credential_id,p.owner_binding_sha256].join('\n')).digest('hex');
  if(!same(expected,p.owner_attestation))fail();
  // Fresh owning normal auth + original-generation read before return; equality
  // is NOT a database transaction/lock, durable writer freeze or ABA guarantee.
  const last=await captureAuthenticatedNativeEvidence(captured,options);originalRetainedRecordDigestAuthority(last);
  for(const k of ['device_id','credential_id','credential_hash','credential_key_id','wire_sha256','generation_id'])if(first[k]!==last[k])fail();
  if(!isDeepStrictEqual(first.context,last.context)||!isDeepStrictEqual(first.verified_binding,last.verified_binding)
   ||!record.equals(opaqueRecord)||!proofBytes.equals(ownerProofBytes)||!raw.equals(req.scanAuthorityRawBody)
   ||!isDeepStrictEqual(captured.headers,req.headers)||!isDeepStrictEqual(captured.body,req.body))fail();
  const result=freeze({schema:'custodial.private-custody-current-owner-observation.v1',state:'CURRENT_AUTH_OWNER_PROOF_ONLY_NOT_CUSTODY',
   record_sha256:p.record_sha256,record_bytes:syntax.record_bytes,capsule_sha256:p.capsule_sha256,owner_binding_sha256:p.owner_binding_sha256,
   owner_proof_wire_sha256:hash(proofBytes),original_wire_sha256:p.original_wire_sha256,original_generation_id:first.generation_id,
   principal_digest:p.principal_digest,engine_revision:syntax.engine_revision,source_capture_sha256:p.source_capture_sha256,
   values_sha256:p.values_sha256,semantic_join_sha256:p.semantic_join_sha256,layout_sha256:p.layout_sha256,
   current_normal_auth_verified_at_observation:true,original_generation_verified_at_observation:true,record_owner_HMAC_verified:true,
   native_current_source_check_is_attested_not_server_observed:true,original_frozen_work_raw_bytes_independently_verified:false,
   original_device_key_GCM_verified_by_server:false,original_values_bytes_recovered:false,writer_authority:false,
   durable_retention:false,current_server_readback:false,complete_namespace_inventory:false,all_writer_durable_freeze_or_ABA_guard:false,
   native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,work_accepted:false,
   new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
  observations.add(result);return result;
 }catch{fail();}finally{record?.fill(0);proofBytes?.fill(0);raw?.fill(0);}
}
export const isAuthenticatedPrivateCustodyOwnerObservation=value=>observations.has(value);
