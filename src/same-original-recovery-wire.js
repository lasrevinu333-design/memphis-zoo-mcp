import {createHash} from 'node:crypto';
import {parseNativeProviderJson} from './native-provider-json.js';

// Representation only. Valid JSON, matching digests or a stored approval ID
// cannot authenticate a manager, register a native challenge or permit effects.
export const recoveryPreparationPurpose = 'AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION';
export const recoveryPreparationAdmission = 'same-original-preparation.v1';
export const recoveryDeniedEffects = Object.freeze({inventory_acknowledged:false,
  work_accepted:false,replay_allowed:false,finalizer_allowed:false,key_removal:false,phone_released:false});
export const recoveryTargetFields = Object.freeze([
  'operation_id','separation_id','separation_authority_revision','canonical_device_pk',
  'canonical_device_id','employee_id','credential_id','assignment_epoch',
  'original_generation_id','original_credential_secret_key_id','principal_digest',
  'engine_revision','original_wire_sha256','original_frozen_work_sha256',
  'capsule_sha256','record_sha256','frame_sha256','plan_sha256','aad_binding_sha256',
  'source_capture_sha256','values_sha256','semantic_join_sha256','layout_sha256',
]);
const uuidFields = new Set(['operation_id','separation_id','canonical_device_pk',
  'employee_id','credential_id','original_generation_id']);
const positiveFields = new Set(['separation_authority_revision','assignment_epoch']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const REQUEST_FIELDS=Object.freeze(['schema','request_id','challenge_id',
  'expected_challenge_sha256','expected_preview_sha256','expected_manager_id',
  'expected_manager_credential_id','expected_manager_device_id','decision','manager_confirmation']);
const PREVIEW_FIELDS=Object.freeze(['schema','state','purpose','challenge_id',
  'challenge_sha256','preview_sha256','original_target','expires_at','limits']);
const RECEIPT_FIELDS=Object.freeze(['schema','state','approval_id','original_request',
  'original_request_sha256','issuer','challenge_sha256','preview_sha256','original_target',
  'purpose_admission_id','issued_at','expires_at','receipt_sha256','retry_safe','limits']);
const failure=()=>{throw Object.assign(new TypeError('same_original_recovery_wire_invalid'),
  {code:'same_original_recovery_wire_invalid',status:400});};
function exact(value,keys) {
  if(!value || Object.getPrototypeOf(value)!==Object.prototype) failure();
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length || own.some(key=>!keys.includes(key))) failure();
  for(const key of keys) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d || !Object.hasOwn(d,'value') || !d.enumerable) failure();
  }
}
function str(value,pattern) {if(typeof value!=='string'||!pattern.test(value))failure();}
function decimal(value,zero=false) {
  str(value,zero?/^(?:0|[1-9][0-9]*)$/:/^[1-9][0-9]*$/);
  if(value.length>16 || BigInt(value)>9007199254740991n) failure();
}
export function recoveryInstantMicros(value) {
  str(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  const [y,m,d,h,min,s,us]=value.match(/\d+/g).map(Number);
  const leap=y%4===0&&(y%100!==0||y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(y<1||m<1||m>12||d<1||d>days[m-1]||h>23||min>59||s>59)failure();
  const prior=y-1;
  const ordinal=365*prior+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)
    +days.slice(0,m-1).reduce((a,b)=>a+b,0)+d-1;
  return (BigInt(ordinal)*86400n+BigInt(h*3600+min*60+s))*1000000n+BigInt(us);
}
function immutable(value) {
  if(value&&typeof value==='object') {for(const item of Object.values(value))immutable(item);Object.freeze(value);}
  return value;
}
function copyValidated(value,validate) {validate(value);return immutable(structuredClone(value));}
function limits(value) {exact(value,Object.keys(recoveryDeniedEffects));
  for(const key of Object.keys(recoveryDeniedEffects))if(value[key]!==false)failure();}
function target(value) {
  exact(value,recoveryTargetFields);
  for(const key of recoveryTargetFields) {
    if(uuidFields.has(key))str(value[key],UUID);
    else if(positiveFields.has(key))decimal(value[key]);
    else if(key==='engine_revision')decimal(value[key],true);
    else if(key==='canonical_device_id')str(value[key],/^KIOSK_0[2-9]$|^KIOSK_10$/);
    else str(value[key],SHA);
  }
}
export function validateRecoveryOriginalTarget(value) {return copyValidated(value,target);}
function request(value) {
  exact(value,REQUEST_FIELDS);
  if(value.schema!=='custodial.same-original-recovery-approval-request.v1'
    ||value.decision!==recoveryPreparationPurpose
    ||value.manager_confirmation!=='CONFIRM_THIS_SAME_ORIGINAL_ONLY')failure();
  for(const key of ['request_id','challenge_id','expected_manager_id','expected_manager_credential_id'])str(value[key],UUID);
  for(const key of ['expected_challenge_sha256','expected_preview_sha256'])str(value[key],SHA);
  str(value.expected_manager_device_id,/^[A-Za-z0-9_-]{1,128}$/);
}
export function validateRecoveryApprovalRequest(value) {return copyValidated(value,request);}
export function decodeRecoveryApprovalRequest(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length>8192)failure();
  return validateRecoveryApprovalRequest(parseNativeProviderJson(bytes));
}
function preview(value) {
  exact(value,PREVIEW_FIELDS);
  if(value.schema!=='custodial.same-original-recovery-review.v1'
    ||value.state!=='ORIGINAL_BINDING_REVIEW_ONLY'||value.purpose!==recoveryPreparationPurpose)failure();
  str(value.challenge_id,UUID);str(value.challenge_sha256,SHA);str(value.preview_sha256,SHA);
  target(value.original_target);recoveryInstantMicros(value.expires_at);limits(value.limits);
}
export function validateRecoveryPreview(value) {
  const result=copyValidated(value,preview);
  if(result.preview_sha256!==recoveryDocumentSha256('preview',result))failure();
  return result;
}
function receipt(value) {
  exact(value,RECEIPT_FIELDS);
  if(value.schema!=='custodial.same-original-recovery-approval-receipt.v1'
    ||value.state!=='APPROVAL_RECORDED_ONLY'||value.purpose_admission_id!==recoveryPreparationAdmission
    ||value.retry_safe!==false)failure();
  str(value.approval_id,UUID);request(value.original_request);target(value.original_target);
  for(const key of ['original_request_sha256','challenge_sha256','preview_sha256','receipt_sha256'])str(value[key],SHA);
  exact(value.issuer,['manager_id','manager_credential_id','manager_device_id']);
  str(value.issuer.manager_id,UUID);str(value.issuer.manager_credential_id,UUID);
  str(value.issuer.manager_device_id,/^[A-Za-z0-9_-]{1,128}$/);
  const r=value.original_request,i=value.issuer;
  if(r.expected_manager_id!==i.manager_id||r.expected_manager_credential_id!==i.manager_credential_id
    ||r.expected_manager_device_id!==i.manager_device_id||r.expected_challenge_sha256!==value.challenge_sha256
    ||r.expected_preview_sha256!==value.preview_sha256)failure();
  const issued=recoveryInstantMicros(value.issued_at),expires=recoveryInstantMicros(value.expires_at);
  if(expires<=issued||expires-issued>300000000n)failure();
  limits(value.limits);
}
export function validateRecoveryApprovalReceipt(value) {
  const result=copyValidated(value,receipt);
  if(result.original_request_sha256!==recoveryDocumentSha256('request',result.original_request)
    ||result.receipt_sha256!==recoveryDocumentSha256('receipt',result))failure();
  return result;
}

// Native registration response REPRESENTATION ONLY. The owning original
// request/current transaction and later manager/native approval are separate.
export function validateRecoveryNativeChallengeReceipt(value) {
  return copyValidated(value,item=>{
    exact(item,['schema','state','challenge_id','challenge_sha256','original_target_sha256',
      'native_challenge_intent_id','native_challenge_intent_record_sha256','registered_at','expires_at','retry_safe','limits']);
    if(item.schema!=='custodial.same-original-recovery-native-challenge-receipt.v1'
      ||item.state!=='ORIGINAL_CHALLENGE_RECORDED_PREPARATION_ONLY'||item.retry_safe!==false)failure();
    str(item.challenge_id,UUID);str(item.native_challenge_intent_id,UUID);
    for(const key of ['challenge_sha256','original_target_sha256','native_challenge_intent_record_sha256'])str(item[key],SHA);
    const registered=recoveryInstantMicros(item.registered_at),expires=recoveryInstantMicros(item.expires_at);
    if(expires<=registered||expires-registered>300000000n)failure();
    limits(item.limits);
  });
}

// Fixed purpose-local document encoding, not an authority/signature system.
// Only the four admitted schemas enter this function. Existing native raw-wire,
// principal and capsule digests retain their original encoding unchanged.
function canonical(value) {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string') {
    for(let n=0;n<value.length;n++) {const u=value.charCodeAt(n);
      if(u>=0xd800&&u<=0xdbff){const next=value.charCodeAt(++n);if(!(next>=0xdc00&&next<=0xdfff))failure();}
      else if(u>=0xdc00&&u<=0xdfff)failure();}
    return JSON.stringify(value);
  }
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)failure();
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export function recoveryDocumentBytes(kind,value) {
  const validators={target,request,preview,receipt};
  if(!Object.hasOwn(validators,kind))failure();validators[kind](value);
  const snapshot=structuredClone(value);
  if(kind==='preview')delete snapshot.preview_sha256;
  if(kind==='receipt')delete snapshot.receipt_sha256;
  return Buffer.from('custodial.same-original-recovery-'+kind+'.v1\n'+canonical(snapshot),'utf8');
}
export function recoveryDocumentSha256(kind,value) {
  return createHash('sha256').update(recoveryDocumentBytes(kind,value)).digest('hex');
}
