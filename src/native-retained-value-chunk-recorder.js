import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
import{originalRetainedValueChunkAuthority}from'./native-retained-wire-intake.js';

// Owning original-evidence route writer. Fixed existing v15 RPCs only; caller-supplied JSON
// cannot become an authenticated capture. Write once, always separate readback,
// no blind retry. Values/credentials/attestations never enter the result.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const RECEIPT=['assignment_epoch','authority_revision','automatic_acceptance','browser_inventory_state','canonical_device_id','credential_id','cutoff_at','device_id','employee_id','generation_id','inventory_acknowledged','manifest_sha256','native_semantic_inventory_state','new_work_allowed','operation_id','payload_coverage','phone_released','raw_snapshot_sha256','receipt_sha256','record_count','record_values_retained','retained_at','schema','separation_id','status','wire_bytes','wire_sha256','work_accepted'];
const PART=['schema','operation_id','native_request_id','request_body_sha256','attestation_digest','wire_sha256','value_bytes','value_sha256','chunk_index','chunk_count','chunk_bytes','chunk_sha256','chunk_base64','stored_chunk_count','record_values_retained','native_semantic_inventory_state','browser_inventory_state','inventory_acknowledged','work_accepted','new_work_allowed','phone_released','key_removal'];
const error=(code,status)=>{throw Object.assign(new Error(code),{code,status});},pending=()=>error('native_value_chunk_retention_pending',503);
const exact=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...k].sort());
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const hash=b=>createHash('sha256').update(b).digest('hex'),definite=code=>({42501:403,22023:400,23505:409,23514:409,40001:409})[code];
function time(text){if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(text))pending();const base=text.slice(0,23)+'Z',date=new Date(base);if(!Number.isFinite(date.getTime())||date.toISOString()!==base)pending();return text;}
function receipt(r,c){if(!exact(r,RECEIPT))pending();const x=c.context,b=c.verified_binding;
 const expected={schema:'custodial.retained-original-native-evidence-receipt.v1',status:'RETAINED_ONLY_PENDING_RECONCILIATION',operation_id:c.operation_id,separation_id:x.separation_id,generation_id:c.generation_id,device_id:x.device_id,canonical_device_id:x.canonical_device_id,credential_id:x.credential_id,employee_id:x.employee_id,assignment_epoch:x.assignment_epoch,authority_revision:x.authority_revision,cutoff_at:x.cutoff_at,wire_sha256:c.wire_sha256,wire_bytes:c.wire_bytes,manifest_sha256:b.manifest_sha256,raw_snapshot_sha256:b.raw_snapshot_sha256,record_count:b.record_count,payload_coverage:'MANIFEST_AND_RECORD_DIGESTS_ONLY',record_values_retained:false,native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,automatic_acceptance:false,work_accepted:false,new_work_allowed:false,phone_released:false};
 for(const[k,v]of Object.entries(expected))if(!isDeepStrictEqual(r[k],v))pending();if(!SHA.test(r.receipt_sha256)||time(r.retained_at)<time(x.cutoff_at))pending();return freeze(structuredClone(r));
}
function part(value,c,a,write=false){if(!exact(value,write?[...PART,'chunk_replayed']:PART))pending();
 const expected={schema:'custodial.private-native-value-chunk-readback.v1',operation_id:a.operation_id,native_request_id:a.native_request_id,request_body_sha256:a.request_body_sha256,attestation_digest:c.attestation_digest,wire_sha256:a.wire_sha256,value_bytes:a.value_bytes,value_sha256:a.value_sha256,chunk_index:a.chunk_index,chunk_count:a.chunk_count,chunk_sha256:a.chunk_sha256,chunk_base64:a.chunk_base64,chunk_bytes:Buffer.from(a.chunk_base64,'base64').length,native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,work_accepted:false,new_work_allowed:false,phone_released:false,key_removal:false};
 for(const[k,v]of Object.entries(expected))if(!isDeepStrictEqual(value[k],v))pending();
 if(typeof value.record_values_retained!=='boolean'||!Number.isSafeInteger(value.stored_chunk_count)||value.stored_chunk_count<1||value.stored_chunk_count>a.chunk_count
  ||value.record_values_retained&&value.stored_chunk_count!==a.chunk_count||write&&typeof value.chunk_replayed!=='boolean')pending();
 const bytes=Buffer.from(value.chunk_base64,'base64');if(bytes.toString('base64')!==value.chunk_base64||bytes.length!==value.chunk_bytes||hash(bytes)!==value.chunk_sha256)pending();return freeze(structuredClone(value));
}
export async function recordPreparedAuthenticatedNativeValueChunk(capture,{db}={}){
 const a=originalRetainedValueChunkAuthority(capture),c=freeze(structuredClone(capture));
 if(c.purpose!=='ORIGINAL_NATIVE_VALUE_CHUNK_PREPARATION_ONLY'||!UUID.test(c.native_request_id)||!SHA.test(c.credential_hash)||!SHA.test(c.credential_key_id)||!db||typeof db.rpc!=='function')pending();
 const args=freeze({p_operation:c.operation_id,p_device:c.device_id,p_credential:c.credential_id,p_credential_hash:c.credential_hash,p_credential_key_id:c.credential_key_id,p_generation:c.generation_id,p_native_request:c.native_request_id,p_attestation_digest:c.attestation_digest,p_request_base64:c.request_base64,p_binding:c.verified_binding});
 let written=null;try{const r=await db.rpc('custodial_v15_retain_original_native_evidence',args);if(r?.error&&definite(r.error.code))error('native_value_chunk_conflict_or_denied',definite(r.error.code));if(!r?.error&&r?.data)written=structuredClone(r.data);}catch(e){if([400,403,409].includes(e?.status))throw e;/* uncertain: read, never resend */}
 const readArgs=freeze({p_operation:c.operation_id,p_device:c.device_id,p_credential:c.credential_id,p_credential_hash:c.credential_hash,p_credential_key_id:c.credential_key_id,p_native_request:c.native_request_id});let read;
 try{read=await db.rpc('custodial_v15_read_retained_native_evidence',readArgs);}catch{pending();}
 if(read?.error){const status=definite(read.error.code);if(status)error('native_value_chunk_readback_denied',status);pending();}
 const r=read?.data;if(!exact(r,['receipt','stored_wire_sha256','stored_wire_bytes','request','value_chunk'])||r.stored_wire_sha256!==c.wire_sha256||r.stored_wire_bytes!==c.wire_bytes
  ||!exact(r.request,['operation_id','native_request_id','attestation_digest','request_body_sha256'])||r.request.operation_id!==c.operation_id||r.request.native_request_id!==c.native_request_id||r.request.attestation_digest!==c.attestation_digest||r.request.request_body_sha256!==c.request_body_sha256)pending();
 const retained=receipt(r.receipt,c),current=part(r.value_chunk,c,a);
 if(written){if(!exact(written,['receipt','replayed','native_request_id','request_body_sha256','value_chunk'])||typeof written.replayed!=='boolean'||written.native_request_id!==c.native_request_id||written.request_body_sha256!==c.request_body_sha256||!isDeepStrictEqual(receipt(written.receipt,c),retained))pending();const earlier=part(written.value_chunk,c,a,true);if(earlier.stored_chunk_count>current.stored_chunk_count||earlier.record_values_retained&&!current.record_values_retained)pending();}
 return freeze({ok:true,data:{schema:'custodial.original-native-value-chunk-result.v1',status:current.record_values_retained?'RAW_VALUES_RETAINED_PENDING_SEMANTIC_RECONCILIATION':'CHUNK_RETAINED_INCOMPLETE_VALUES',
  native_request_id:a.native_request_id,request_body_sha256:a.request_body_sha256,receipt:retained,
  value_bytes:a.value_bytes,value_sha256:a.value_sha256,chunk_index:a.chunk_index,chunk_count:a.chunk_count,chunk_sha256:a.chunk_sha256,stored_chunk_count:current.stored_chunk_count,
  chunk_commit_and_actual_attempt_readback_confirmed:true,chunk_bytes_readback_confirmed:true,write_outcome_reconciled:written===null,record_values_retained:current.record_values_retained,
  native_semantic_inventory_state:'UNKNOWN',browser_inventory_state:'UNKNOWN',inventory_acknowledged:false,automatic_acceptance:false,work_accepted:false,new_work_allowed:false,phone_released:false,key_removal:false}});
}
