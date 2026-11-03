import {isDeepStrictEqual} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {decodeRecoveryApprovalRequest,validateRecoveryPreview,validateRecoveryApprovalReceipt} from './same-original-recovery-wire.js';

// Fixed server composition for the existing private backend client. No caller
// RPC name, role fallback, retry, challenge insert or native effect is exposed.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=(code='same_original_recovery_store_unavailable',status=503)=>{
  throw Object.assign(new Error(code),{code,status,retry_safe:false});
};
export function createSameOriginalRecoveryStore({db,inspectAuthenticatedIssuer}={}) {
  if(typeof db?.rpc!=='function'||typeof inspectAuthenticatedIssuer!=='function')fail();
  function binding(issuer,{confirmation=false}={}) {
    let value;try{value=inspectAuthenticatedIssuer(issuer);}catch{fail('same_original_recovery_issuer_unbound',403);}
    if(!value||value.issuer!==issuer||value.observation_only!==true||value.transaction_authority!==false
      ||confirmation&&value.confirmation_csrf_verified!==true)fail('same_original_recovery_issuer_unbound',403);
    return Object.freeze({p_manager:issuer.manager_id,p_credential:issuer.manager_credential_id,
      p_device:issuer.manager_device_id,p_signed_expires:value.signed_session_expires_at,
      p_security_session:value.security_session_id,p_password_version:value.security_password_version,
      p_security_hash:value.security_token_hash,p_csrf_hash:value.security_csrf_hash});
  }
  function original(originalRequest,originalRequestUtf8,issuer) {
    if(typeof originalRequestUtf8!=='string'||Buffer.byteLength(originalRequestUtf8,'utf8')>8192)fail('same_original_recovery_original_invalid',400);
    let request;try{request=decodeRecoveryApprovalRequest(Buffer.from(originalRequestUtf8,'utf8'));}catch{fail('same_original_recovery_original_invalid',400);}
    if(!isDeepStrictEqual(request,originalRequest)||request.expected_manager_id!==issuer.manager_id
      ||request.expected_manager_credential_id!==issuer.manager_credential_id
      ||request.expected_manager_device_id!==issuer.manager_device_id)fail('same_original_recovery_original_invalid',400);
    return request;
  }
  async function call(name,args) {
    let result;try{result=await db.rpc(name,args);}catch{fail('same_original_recovery_outcome_unknown');}
    if(result?.error) {
      if(result.error.code==='42501')fail('same_original_recovery_current_authority_denied',403);
      if(['23505','40001','22023'].includes(result.error.code))fail('same_original_recovery_original_conflict',409);
      fail('same_original_recovery_outcome_unknown');
    }
    if(result?.data===null)return null;
    if(typeof result?.data!=='string'||!result.data.length||Buffer.byteLength(result.data,'utf8')>24576)fail('same_original_recovery_response_invalid');
    try{return parseNativeProviderJson(Buffer.from(result.data,'utf8'));}catch{fail('same_original_recovery_response_invalid');}
  }
  async function readVerifiedChallenge({challengeId,issuer}) {
    if(typeof challengeId!=='string'||!UUID.test(challengeId))fail('same_original_recovery_challenge_invalid',400);
    const args=Object.freeze({...binding(issuer),p_challenge:challengeId});
    const data=await call('custodial_same_original_preparation_preview_v1',args);
    if(data===null)return null;
    let preview;try{preview=validateRecoveryPreview(data);}catch{fail('same_original_recovery_response_invalid');}
    if(preview.challenge_id!==challengeId)fail('same_original_recovery_response_invalid');
    return preview; // Pin only. Native source provenance belongs to the owning SQL/producer.
  }
  async function issueOriginalApprovalOnce({originalRequest,originalRequestUtf8,issuer,verifiedPreview}) {
    const auth=binding(issuer,{confirmation:true});
    const request=original(originalRequest,originalRequestUtf8,issuer);
    let preview;try{preview=validateRecoveryPreview(verifiedPreview);}catch{fail('same_original_recovery_preview_invalid',400);}
    if(request.challenge_id!==preview.challenge_id||request.expected_challenge_sha256!==preview.challenge_sha256
      ||request.expected_preview_sha256!==preview.preview_sha256)fail('same_original_recovery_original_conflict',409);
    const privateBinding=inspectAuthenticatedIssuer(issuer);
    const args=Object.freeze({...auth,p_signed_sha:privateBinding.signed_session_sha256,p_original_utf8:originalRequestUtf8});
    const data=await call('custodial_same_original_preparation_issue_v1',args);
    if(data===null)return null;
    let receipt;try{receipt=validateRecoveryApprovalReceipt(data);}catch{fail('same_original_recovery_response_invalid');}
    if(!isDeepStrictEqual(receipt.original_request,request)||!isDeepStrictEqual(receipt.original_target,preview.original_target))
      fail('same_original_recovery_response_invalid');
    return receipt;
  }
  async function readOriginalApproval({originalRequest,originalRequestUtf8,issuer}) {
    const auth=binding(issuer,{confirmation:true}),request=original(originalRequest,originalRequestUtf8,issuer);
    const data=await call('custodial_same_original_preparation_status_v1',Object.freeze({...auth,p_original_utf8:originalRequestUtf8}));
    if(data===null)return null;
    let receipt;try{receipt=validateRecoveryApprovalReceipt(data);}catch{fail('same_original_recovery_response_invalid');}
    if(!isDeepStrictEqual(receipt.original_request,request))fail('same_original_recovery_response_invalid');
    return receipt; // Historical original evidence; NEVER a current native grant.
  }
  return Object.freeze({readVerifiedChallenge,issueOriginalApprovalOnce,readOriginalApproval});
}
