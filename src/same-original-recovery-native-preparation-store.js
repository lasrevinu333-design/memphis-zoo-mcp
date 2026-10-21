import {createHash} from 'node:crypto';
import {isDeepStrictEqual,types} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {decodeSameOriginalRecoveryNativeChallenge} from './same-original-recovery-native-challenge-wire.js';
import {validateRecoveryNativeChallengeReceipt,validateRecoveryApprovalReceipt,validateRecoveryPreview,
  recoveryInstantMicros,recoveryPreparationPurpose,recoveryDeniedEffects} from './same-original-recovery-wire.js';

const bindingKeys=['capture','observation_only','transaction_authority','original_request_utf8','original_target',
  'native_challenge_intent_id','native_challenge_intent_record_sha256','rpc_parameters'];
const parameterKeys=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation',
  'p_chunk_index','p_original_write_request','p_original_write_body_sha256','p_original_write_attestation_digest',
  'p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_utf8'];
const representationKeys=['schema','state','purpose_admission_id','original_registration_utf8',
  'original_approval_receipt_utf8','observed_at','current_until','transaction_authority','limits'];
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
function fail(code='same_original_recovery_native_preparation_unknown',status=503){
  throw Object.assign(new Error(code),{code,status,outcome:'UNKNOWN',retry_safe:false,limits:recoveryDeniedEffects});
}
function closed(value,keys){
  if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
  const names=Reflect.ownKeys(value);
  if(names.length!==keys.length||names.some(key=>!keys.includes(key)))fail();
  const result={};
  for(const key of keys){const field=Object.getOwnPropertyDescriptor(value,key);
    if(!field||!Object.hasOwn(field,'value')||!field.enumerable)fail();result[key]=field.value;}
  return result;
}
function field(value,key){
  if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
}
function method(value,key){
  if(!value||typeof value!=='object'||types.isProxy(value))fail('same_original_recovery_native_preparation_unavailable');
  for(let owner=value;owner;owner=Object.getPrototypeOf(owner)){
    if(types.isProxy(owner))fail('same_original_recovery_native_preparation_unavailable');
    const descriptor=Object.getOwnPropertyDescriptor(owner,key);
    if(descriptor){if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function'||types.isProxy(descriptor.value))fail('same_original_recovery_native_preparation_unavailable');return descriptor.value;}
  }fail('same_original_recovery_native_preparation_unavailable');
}
function utf8(value,max){
  if(typeof value!=='string'||!value.length||Buffer.byteLength(value,'utf8')>max)fail();
  const bytes=Buffer.from(value,'utf8');
  try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)!==value)fail();return bytes;}
  catch{bytes.fill(0);fail();}
}
function document(value,max){const bytes=utf8(value,max);
  try{return parseNativeProviderJson(bytes);}finally{bytes.fill(0);}}
function instant(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)||value.length!==27)fail();
  return recoveryInstantMicros(value);
}

// Main MUST bind the purpose-specific private preparation inspector, never a
// writer/status inspector. This module does not authenticate an arbitrary
// supplied callback or create a brand from receipt/JSON fields.
export function createSameOriginalRecoveryNativePreparationStore(privateDependencies){
  const {db,inspectAuthenticatedNativePreparationRead:inspect}=closed(privateDependencies,['db','inspectAuthenticatedNativePreparationRead']);
  const rpc=method(db,'rpc');
  if(typeof inspect!=='function'||types.isProxy(inspect))fail('same_original_recovery_native_preparation_unavailable');
  const attempted=new WeakSet();
  function snapshot(capture){
    let observed;try{observed=inspect(capture);}catch{fail('same_original_recovery_native_preparation_capture_unbound',403);}
    const binding=closed(observed,bindingKeys);
    if(!Object.isFrozen(observed)||binding.capture!==capture||binding.observation_only!==true
      ||binding.transaction_authority!==false||!Object.isFrozen(binding.rpc_parameters))fail();
    const params=closed(binding.rpc_parameters,parameterKeys);
    if(params.p_chunk_index!==0||parameterKeys.some(key=>key!=='p_chunk_index'&&(typeof params[key]!=='string'||!params[key].length))
      ||params.p_original_utf8!==binding.original_request_utf8)fail();
    const bytes=utf8(binding.original_request_utf8,786432);let original;
    try{original=decodeSameOriginalRecoveryNativeChallenge(bytes);if(sha(bytes)!==params.p_native_request_body_sha256)fail();}
    catch{fail();}
    finally{bytes.fill(0);}
    const target=original.original_target;
    if(!isDeepStrictEqual(target,binding.original_target)||original.native_challenge_intent_id!==binding.native_challenge_intent_id
      ||original.native_challenge_intent_record_sha256!==binding.native_challenge_intent_record_sha256
      ||params.p_native_request!==original.native_challenge_intent_id||params.p_operation!==target.operation_id
      ||params.p_device!==target.canonical_device_pk||params.p_credential!==target.credential_id
      ||params.p_generation!==target.original_generation_id||params.p_credential_key_id!==target.original_credential_secret_key_id)fail();
    const time=params.p_native_request_timestamp;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time)||time.length!==24)fail();
    let requestMicros;try{requestMicros=instant(time.slice(0,-1)+'000Z');}catch{fail();}
    return Object.freeze({capture,raw:binding.original_request_utf8,original,requestMicros,parameters:binding.rpc_parameters});
  }
  function unchanged(capture,original){
    let current;try{current=snapshot(capture);}catch{fail();}
    if(current.capture!==original.capture||current.raw!==original.raw||!isDeepStrictEqual(current.original,original.original)
      ||!isDeepStrictEqual(current.parameters,original.parameters))fail();
  }
  function representation(result,original){
    if(!result||typeof result!=='object'||types.isProxy(result))fail();
    const data=Object.getOwnPropertyDescriptor(result,'data'),error=Object.getOwnPropertyDescriptor(result,'error');
    if(!data||!Object.hasOwn(data,'value')||(error&&(!Object.hasOwn(error,'value')||error.value)))fail();
    const value=closed(document(data.value,65536),representationKeys);
    if(value.schema!=='custodial.same-original-current-manager-preparation.v1'
      ||value.state!=='CURRENT_MANAGER_PREPARATION_OBSERVED_NO_EFFECT_RIGHTS'
      ||value.purpose_admission_id!=='same-original-preparation.v1'||value.transaction_authority!==false
      ||!isDeepStrictEqual(closed(value.limits,Object.keys(recoveryDeniedEffects)),recoveryDeniedEffects))fail();
    const registration=validateRecoveryNativeChallengeReceipt(document(value.original_registration_utf8,24576));
    const approval=validateRecoveryApprovalReceipt(document(value.original_approval_receipt_utf8,24576));
    const body=original.original,params=original.parameters;
    if(registration.challenge_id!==body.native_challenge_intent_id||registration.native_challenge_intent_id!==body.native_challenge_intent_id
      ||registration.native_challenge_intent_record_sha256!==body.native_challenge_intent_record_sha256
      ||registration.original_target_sha256!==body.original_target_sha256||!isDeepStrictEqual(approval.original_target,body.original_target)
      ||approval.original_request.challenge_id!==registration.challenge_id||approval.challenge_sha256!==registration.challenge_sha256)fail();
    const registered=instant(registration.registered_at),registrationExpiry=instant(registration.expires_at);
    if(registered<original.requestMicros-30000000n||registered>original.requestMicros+120000000n
      ||registrationExpiry>original.requestMicros+300000000n)fail();
    const transcript=['custodial.same-original-native-challenge-binding.v1',body.native_challenge_intent_id,
      params.p_native_request_body_sha256,params.p_native_attestation_digest,body.native_challenge_intent_record_sha256,
      body.original_target_sha256,registration.registered_at,registration.expires_at].join('\n');
    if(registration.challenge_sha256!==sha(transcript))fail();
    validateRecoveryPreview({schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',
      purpose:recoveryPreparationPurpose,challenge_id:registration.challenge_id,challenge_sha256:registration.challenge_sha256,
      preview_sha256:approval.preview_sha256,original_target:body.original_target,expires_at:registration.expires_at,limits:recoveryDeniedEffects});
    const observed=instant(value.observed_at),until=instant(value.current_until),approvalExpiry=instant(approval.expires_at);
    if(observed>=until||observed<instant(approval.issued_at)||until>registrationExpiry||until>approvalExpiry||approvalExpiry>registrationExpiry)fail();
    const output=Object.freeze({...value,limits:recoveryDeniedEffects});
    if(Buffer.byteLength(JSON.stringify({ok:true,data:output}),'utf8')>131072)fail();
    return output;
  }
  async function readCurrentManagerPreparationOnce(capture){
    if(!capture||typeof capture!=='object'||types.isProxy(capture))fail('same_original_recovery_native_preparation_capture_unbound',403);
    if(attempted.has(capture))fail('same_original_recovery_native_preparation_already_attempted');
    attempted.add(capture); // Consumed even on lost reply, closure or current-authority denial.
    const original=snapshot(capture);let result,error;
    try{result=await Reflect.apply(rpc,db,['custodial_same_original_current_manager_preparation_v1',original.parameters]);}
    catch(caught){error=caught;}
    unchanged(capture,original);
    if(field(error,'code')==='42501'||field(field(result,'error'),'code')==='42501')fail('same_original_recovery_native_preparation_current_authority_denied',403);
    if(error)fail();
    try{return representation(result,original);}catch{fail();}
  }
  return Object.freeze({readCurrentManagerPreparationOnce});
}
