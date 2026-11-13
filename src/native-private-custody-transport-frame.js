import {createHash,timingSafeEqual} from 'node:crypto';
import {inspectPrivateCustodyRecordSyntax,privateCustodyRecordSyntaxLimits} from './native-private-custody-record.js';
import {observeAuthenticatedPrivateCustodyOwner,isAuthenticatedPrivateCustodyOwnerObservation} from './native-private-custody-owner-proof.js';

// UNMOUNTED exact binary frame. Native purpose-HMAC + existing normal WORK
// request prove ONLY an observed owner identity. That existing request does
// NOT attest this frame as a new custody request, operation or write witness.
// No route/SQL/writer/receipt/raw output. No IDs or ACK authority invented.
const SCHEMA='custodial.native-private-eight-custody-transport-frame.v1',MAGIC=0x4d5a5431,PROOF=8192,
 MAX=privateCustodyRecordSyntaxLimits.record_bytes+PROOF+4+4+SCHEMA.length*2+4+4+32,
 syntax=new WeakSet(),observed=new WeakSet(),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(new Error('native_private_custody_transport_frame_invalid'),{code:'native_private_custody_transport_frame_invalid',status:403});};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function copy(input){if(!Buffer.isBuffer(input)||Object.getPrototypeOf(input)!==Buffer.prototype||input.buffer instanceof SharedArrayBuffer||input.length<64||input.length>MAX)fail();return Buffer.from(input);}
function parse(owned){
 const end=owned.length-32,checksum=createHash('sha256').update(owned.subarray(0,end)).digest();
 try{if(!timingSafeEqual(checksum,owned.subarray(end)))fail();}finally{checksum.fill(0);}
 let at=0;const take=n=>{if(!Number.isSafeInteger(n)||n<0||n>end-at)fail();const b=owned.subarray(at,at+n);at+=n;return b;},int=()=>take(4).readInt32BE(0);
 if(int()!==MAGIC||int()!==SCHEMA.length)fail();const text=take(SCHEMA.length*2);for(let i=0;i<SCHEMA.length;i++)if(text.readUInt16BE(i*2)!==SCHEMA.charCodeAt(i))fail();
 const proofBytes=int();if(proofBytes<1||proofBytes>PROOF)fail();const proof=take(proofBytes),recordBytes=int();
 if(recordBytes<64||recordBytes>privateCustodyRecordSyntaxLimits.record_bytes)fail();const record=take(recordBytes);if(at!==end)fail();
 const recordMetadata=inspectPrivateCustodyRecordSyntax(record);return {proof,record,recordMetadata};
}
const limits=()=>({durable_operation_id_bound:false,original_chunk_write_attempt_read_query_identities_bound:false,
 frame_request_attestation_bound:false,network_dispatch_allowed:false,writer_authority:false,durable_retention:false,current_server_readback:false,
 complete_namespace_inventory:false,all_writer_durable_freeze_or_ABA_guard:false,inventory_acknowledged:false,work_accepted:false,
 new_work_allowed:false,resend_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
export function inspectPrivateCustodyTransportFrameSyntax(input){let own;
 try{own=copy(input);const p=parse(own),result=freeze({schema:'custodial.private-custody-transport-frame-syntax.v1',state:'OPAQUE_FRAME_SYNTAX_ONLY_NOT_AUTHORITY',
  frame_schema:SCHEMA,frame_bytes:own.length,frame_sha256:sha(own),record_sha256:p.recordMetadata.record_sha256,proof_wire_sha256:sha(p.proof),
  container_checksum_matches:true,checksum_is_authentication:false,proof_owner_HMAC_verified:false,current_normal_auth_verified:false,...limits()});
  syntax.add(result);return result;
 }catch{fail();}finally{own?.fill(0);}
}
export async function observeAuthenticatedPrivateCustodyTransportFrame(req,input,options={}){let own;
 try{own=copy(input);const p=parse(own),owner=await observeAuthenticatedPrivateCustodyOwner(req,p.record,p.proof,options);
  if(!isAuthenticatedPrivateCustodyOwnerObservation(owner)||!own.equals(input))fail();
  const result=freeze({schema:'custodial.private-custody-transport-frame-owner-observation.v1',state:'CURRENT_AUTH_FRAME_OWNER_ONLY_NOT_CUSTODY',
   frame_schema:SCHEMA,frame_bytes:own.length,frame_sha256:sha(own),record_sha256:owner.record_sha256,proof_wire_sha256:owner.owner_proof_wire_sha256,
   owner_binding_sha256:owner.owner_binding_sha256,capsule_sha256:owner.capsule_sha256,principal_digest:owner.principal_digest,
   original_generation_id:owner.original_generation_id,current_normal_auth_verified_at_observation:true,record_owner_HMAC_verified:true,
   original_WORK_request_identity_link_only:true,native_current_source_check_is_attested_not_server_observed:true,
   original_frozen_work_raw_bytes_independently_verified:false,original_device_key_GCM_verified_by_server:false,original_values_bytes_recovered:false,
   native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',...limits()});observed.add(result);return result;
 }catch{fail();}finally{own?.fill(0);}
}
export const isSyntaxOnlyPrivateCustodyTransportFrame=value=>syntax.has(value);
// No caller proof becomes authority here: the owning exchange separately
// supplies its privately captured, already authenticated original proof.
// This closed byte/record comparison does not decrypt any namespace values.
export function inspectPrivateCustodyTransportFrameOriginalBinding(input,expectedProof,expectedRecord){let own,proof;
 try{own=copy(input);if(!Buffer.isBuffer(expectedProof)||Object.getPrototypeOf(expectedProof)!==Buffer.prototype||expectedProof.buffer instanceof SharedArrayBuffer||expectedProof.length<1||expectedProof.length>PROOF)fail();
  proof=Buffer.from(expectedProof);const p=parse(own);if(!p.proof.equals(proof)||!expectedRecord||Object.getPrototypeOf(expectedRecord)!==Object.prototype)fail();
  for(const k of ['record_sha256','record_bytes','capsule_sha256','aad_binding_sha256','source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256',
   'principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'])
   if(expectedRecord[k]!==String(p.recordMetadata[k]))fail();
  return inspectPrivateCustodyTransportFrameSyntax(own);
 }catch{fail();}finally{own?.fill(0);proof?.fill(0);}
}
export const isAuthenticatedPrivateCustodyTransportFrameObservation=value=>observed.has(value);
export const privateCustodyTransportFrameLimits=Object.freeze({frame_bytes:MAX,proof_bytes:PROOF,record_bytes:privateCustodyRecordSyntaxLimits.record_bytes});
