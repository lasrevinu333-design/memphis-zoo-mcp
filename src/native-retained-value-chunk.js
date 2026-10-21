import{createHash}from'node:crypto';
import{originalRetainedValueChunkAuthority,nativeValueChunkTransportLimits as limits}from'./native-retained-wire-intake.js';
import{verifyOriginalNativeRecordValues}from'./native-retained-record-values.js';

// UNMOUNTED, memory-only preparation. A complete set is not persisted, a
// native emit, semantic inventory, ACK, work acceptance or key/reuse authority.
const completeMatches=new WeakSet();
const fail=()=>{throw Object.assign(new Error('native_retained_value_chunks_invalid'),{code:'native_retained_value_chunks_invalid',status:400});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
export function verifyCompleteOriginalNativeValueChunks(captures){
 if(!Array.isArray(captures)||!captures.length||captures.length>limits.chunks)fail();
 const parts=[];for(let i=0;i<captures.length;i++){if(!Object.hasOwn(captures,i))fail();parts.push(originalRetainedValueChunkAuthority(captures[i]));}
 const first=parts[0],requests=new Set();
 if(parts.length!==first.chunk_count)fail();
 const same=['operation_id','generation_id','separation_id','manifest_sha256','raw_snapshot_sha256','record_count','wire_sha256','value_bytes','value_sha256','chunk_count'];
 const buffers=[],witnesses=[];
 for(let i=0;i<parts.length;i++){
  const part=parts[i];if(part.chunk_index!==i||same.some(key=>part[key]!==first[key])||requests.has(part.native_request_id))fail();
  requests.add(part.native_request_id);const bytes=Buffer.from(part.chunk_base64,'base64');
  if(bytes.toString('base64')!==part.chunk_base64||hash(bytes)!==part.chunk_sha256)fail();buffers.push(bytes);
  witnesses.push({native_request_id:part.native_request_id,request_body_sha256:part.request_body_sha256,chunk_index:i,chunk_sha256:part.chunk_sha256});
 }
 const bytes=Buffer.concat(buffers);if(bytes.length!==first.value_bytes||hash(bytes)!==first.value_sha256)fail();
 const matched=verifyOriginalNativeRecordValues(captures[0],bytes);
 const result=freeze({...matched,schema:'custodial.complete-original-native-value-chunks.v1',verification:'ALL_ATTESTED_CHUNKS_AND_ORIGINAL_RAW_VALUES_MATCHED_PREPARATION_ONLY',
  chunk_count:first.chunk_count,wire_sha256:first.wire_sha256,chunk_request_witnesses:witnesses,
  record_values_retained:false,inventory_acknowledged:false,automatic_acceptance:false,work_accepted:false,new_work_allowed:false,phone_released:false,key_removal:false});
 completeMatches.add(result);return result;
}
export const isVerifiedCompleteOriginalNativeValueChunks=value=>completeMatches.has(value);
export const nativeValueChunkPreparationLimits=limits;
