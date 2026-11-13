import {types} from 'node:util';
import {decodeCurrentOriginalPrivateQueryRead} from './native-private-custody-current-query-wire.js';
import {validateRecoveryOriginalTarget,recoveryDocumentSha256,recoveryPreparationPurpose} from './same-original-recovery-wire.js';

// Representation ONLY. The exact seven returned fields are UNTRUSTED data.
// Matching intent formats/digests/QUERY pins cannot establish durable intent,
// current credentials, native provenance, manager approval or any effect.
const schema='custodial.same-original-recovery-native-challenge.v1';
const MAX=786432,CURRENT_MAX=526336,QUERY_MAX=393216;
const fields=['schema','purpose','native_challenge_intent_id','native_challenge_intent_record_sha256',
  'current_original_query_envelope_base64','original_target','original_target_sha256'];
const queryFields=['schema','operation_id','original_generation_id','principal_digest','engine_revision',
  'original_frozen_work_sha256','frame_sha256','record_sha256','plan_sha256','frame_bytes','chunk_count','chunk_index',
  'offset','chunk_bytes','chunk_sha256','write_id','attempt_id','read_query_id','owner_proof_base64',
  'original_signed_wire_base64','purpose_binding_sha256','purpose_attestation','target_native_request_id',
  'target_request_body_sha256','target_attestation_digest','target_prepared_record_sha256','target_unknown_record_sha256'];
const pins=['operation_id','original_generation_id','principal_digest','engine_revision','original_frozen_work_sha256','frame_sha256','record_sha256','plan_sha256'];
const uuidFields=['operation_id','original_generation_id','write_id','attempt_id','read_query_id','target_native_request_id'];
const shaFields=['principal_digest','original_frozen_work_sha256','frame_sha256','record_sha256','plan_sha256','chunk_sha256',
  'purpose_binding_sha256','purpose_attestation','target_request_body_sha256','target_attestation_digest','target_prepared_record_sha256','target_unknown_record_sha256'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const typed=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,
  getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,
  arrayLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,set=typed.set;
function invalid(cause){throw Object.assign(new TypeError('same original recovery native challenge wire invalid',{cause}),
  {code:'same_original_recovery_native_challenge_wire_invalid',status:400});}
function ownInput(value,max=MAX){
  // Proxy detection precedes reflection/brand checks: no caller traps/getters.
  if(types.isProxy(value)||!Buffer.isBuffer(value)||Object.getPrototypeOf(value)!==Buffer.prototype)invalid();
  let backing,length,offset,capacity;
  try{
    backing=Reflect.apply(getBuffer,value,[]);length=Reflect.apply(getLength,value,[]);offset=Reflect.apply(getOffset,value,[]);
    capacity=Reflect.apply(arrayLength,backing,[]); // Shared/detached/fake brands cannot substitute backing bytes.
    if(Object.getPrototypeOf(backing)!==ArrayBuffer.prototype)invalid();
  }catch(error){invalid(error);}
  if(!Number.isSafeInteger(length)||length<1||length>max||!Number.isSafeInteger(offset)||offset<0||offset+length>capacity)invalid();
  const owned=Buffer.alloc(length);
  try{Reflect.apply(set,owned,[new Uint8Array(backing,offset,length)]);return owned;}
  catch(error){owned.fill(0);invalid(error);}
}
function utf8(bytes){let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch(error){invalid(error);}
  if(text.startsWith('\uFEFF'))invalid();return text;
}
// This NEW protocol is objects/strings only, bounded independently of the
// unchanged native-provider64KiB parser. No arrays/numbers/literals or unknown
// duplicate keys (including escaped spelling) enter validation/serialization.
function parse(text){
  let at=0,values=0;
  const ws=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
  function string(){
    if(text[at]!=='"')invalid();const start=at++;
    while(at<text.length){const code=text.charCodeAt(at++);
      if(code===34){let result;try{result=JSON.parse(text.slice(start,at));}catch(error){invalid(error);}
        for(let index=0;index<result.length;index++){
          const unit=result.charCodeAt(index);
          if(unit>=0xd800&&unit<=0xdbff){const next=result.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))invalid();}
          else if(unit>=0xdc00&&unit<=0xdfff)invalid();
        }return result;}
      if(code<32)invalid();
      if(code===92){if(at>=text.length)invalid();const escape=text[at++];
        if(escape==='u'){if(!/^[a-fA-F0-9]{4}$/.test(text.slice(at,at+4)))invalid();at+=4;}
        else if(!'"\\/bfnrt'.includes(escape))invalid();}
    }invalid();
  }
  function value(depth){
    if(depth>4||++values>128)invalid();ws();if(text[at]==='"')return string();
    if(text[at++]!=='{')invalid();const object=Object.create(null),seen=new Set();ws();
    if(text[at]==='}'){at++;return object;}
    while(at<text.length){ws();const key=string();if(seen.has(key))invalid();seen.add(key);ws();
      if(text[at++]!==':')invalid();object[key]=value(depth+1);ws();const end=text[at++];
      if(end==='}')return object;if(end!==',')invalid();
    }invalid();
  }
  const result=value(0);ws();if(at!==text.length)invalid();return result;
}
function exact(object,keys){
  if(!object||Object.getPrototypeOf(object)!==null||Object.keys(object).length!==keys.length
    ||keys.some(key=>!Object.hasOwn(object,key)))invalid();
}
function base64(text,max){
  if(typeof text!=='string'||!text.length||text.length>4*Math.ceil(max/3)||text.length%4!==0
    ||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))invalid();
  const bytes=Buffer.from(text,'base64');
  if(!bytes.length||bytes.length>max||bytes.toString('base64')!==text){bytes.fill(0);invalid();}return bytes;
}
export function decodeSameOriginalRecoveryNativeChallenge(input){
  let owned,currentBytes,queryBytes;
  try{
    owned=ownInput(input);const body=parse(utf8(owned));exact(body,fields);
    if(fields.some(key=>key!=='original_target'&&typeof body[key]!=='string')||body.schema!==schema
      ||body.purpose!==recoveryPreparationPurpose||!UUID.test(body.native_challenge_intent_id)
      ||!SHA.test(body.native_challenge_intent_record_sha256)||!SHA.test(body.original_target_sha256))invalid();
    if(!body.original_target||Object.getPrototypeOf(body.original_target)!==null)invalid();
    const target=validateRecoveryOriginalTarget(Object.fromEntries(Object.entries(body.original_target)));
    if(body.original_target_sha256!==recoveryDocumentSha256('target',target))invalid();
    currentBytes=base64(body.current_original_query_envelope_base64,CURRENT_MAX);
    const current=decodeCurrentOriginalPrivateQueryRead(currentBytes); // Actual unchanged nested decoder, never re-encoded.
    queryBytes=base64(current.original_query_body_base64,QUERY_MAX);const query=parse(utf8(queryBytes));exact(query,queryFields);
    if(query.schema!=='custodial.original-native-private-custody-query.v1'
      ||queryFields.some(key=>typeof query[key]!=='string'||!query[key].length)
      ||uuidFields.some(key=>!UUID.test(query[key]))||shaFields.some(key=>!SHA.test(query[key]))
      ||pins.some(key=>query[key]!==target[key]))invalid();
    return Object.freeze(Object.fromEntries(fields.map(key=>[key,key==='original_target'?target:body[key]])));
  }catch(error){if(error?.code==='same_original_recovery_native_challenge_wire_invalid')throw error;invalid(error);}
  finally{owned?.fill(0);currentBytes?.fill(0);queryBytes?.fill(0);}
}

// Read-only representation of the SAME original challenge, not a renewed
// challenge, authenticated capture, persisted outcome or permission to retry.
const statusSchema='custodial.same-original-recovery-native-status.v1',STATUS_MAX=1050624;
const statusFields=['schema','purpose','original_challenge_body_base64',
  'original_challenge_timestamp','original_challenge_http_attestation'];
export function decodeSameOriginalRecoveryNativeStatus(input){
  return decodeNativeOriginalRead(input,statusSchema,'OBSERVE_ORIGINAL_REGISTRATION_ONLY');
}
export function decodeSameOriginalRecoveryNativePreparationRead(input){
  return decodeNativeOriginalRead(input,'custodial.same-original-manager-preparation-native-read.v1',
    'READ_CURRENT_ORIGINAL_MANAGER_PREPARATION_ONLY');
}
function decodeNativeOriginalRead(input,expectedSchema,expectedPurpose){
  let owned,original;
  try{
    owned=ownInput(input,STATUS_MAX);const body=parse(utf8(owned));exact(body,statusFields);
    if(statusFields.some(key=>typeof body[key]!=='string')||body.schema!==expectedSchema
      ||body.purpose!==expectedPurpose
      ||body.original_challenge_http_attestation.length!==64||!SHA.test(body.original_challenge_http_attestation))invalid();
    const timestamp=body.original_challenge_timestamp;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
      ||Number(timestamp.slice(0,4))<1)invalid();
    const civil=new Date(timestamp);
    if(!Number.isFinite(civil.getTime())||civil.toISOString()!==timestamp)invalid();
    original=base64(body.original_challenge_body_base64,MAX);
    decodeSameOriginalRecoveryNativeChallenge(original); // Existing strict decoder; no body reconstruction.
    return Object.freeze(Object.fromEntries(statusFields.map(key=>[key,body[key]])));
  }catch(error){
    throw Object.assign(new TypeError('same original recovery native status wire invalid',{cause:error}),
      {code:'same_original_recovery_native_status_wire_invalid',status:400});
  }finally{owned?.fill(0);original?.fill(0);}
}
