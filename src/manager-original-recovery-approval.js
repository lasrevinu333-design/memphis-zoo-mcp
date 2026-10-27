import {isDeepStrictEqual} from 'node:util';
import {decodeRecoveryApprovalRequest,validateRecoveryApprovalRequest,
  validateRecoveryPreview,validateRecoveryApprovalReceipt,recoveryInstantMicros,
  recoveryDeniedEffects} from './same-original-recovery-wire.js';

// Unmounted product handlers. Main owns ingress/CSRF/current rights, private
// challenge provenance and the atomic issue/read ports. No SQL or in-memory
// approval authority exists here. Representation/digests are not authentication.
const base='/admin-api/device-security/same-original-recovery';
export const managerOriginalRecoveryApprovalPaths=Object.freeze({
  preview:base+'/challenges/:challengeId',confirm:base+'/approvals',
  originalStatus:base+'/approvals/original-status',
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const issuerFields=['manager_id','manager_credential_id','manager_device_id'];
const refusal=(status,code)=>Object.assign(new Error(code),{status,code});
const invalid=()=>{throw refusal(400,'same_original_recovery_input_invalid');};
function own(value,key){const field=Object.getOwnPropertyDescriptor(value,key);
  if(!field||!Object.hasOwn(field,'value')||!field.enumerable)invalid();return field.value;}
function issuerValues(issuer){
  if(!issuer||Object.getPrototypeOf(issuer)!==Object.prototype||!Object.isFrozen(issuer)
    ||!isDeepStrictEqual(Reflect.ownKeys(issuer).slice().sort(),issuerFields.slice().sort()))
    throw refusal(403,'same_original_recovery_issuer_denied');
  const result=Object.fromEntries(issuerFields.map(key=>[key,own(issuer,key)]));
  if(typeof result.manager_id!=='string'||!uuid.test(result.manager_id)
    ||typeof result.manager_credential_id!=='string'||!uuid.test(result.manager_credential_id)
    ||typeof result.manager_device_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(result.manager_device_id))
    throw refusal(403,'same_original_recovery_issuer_denied');
  return Object.freeze(result);
}
function headerValues(headers){
  if(!headers||Object.getPrototypeOf(headers)!==Object.prototype)invalid();
  const result={};for(const key of Reflect.ownKeys(headers)){
    if(typeof key!=='string'||key==='__proto__')invalid();const value=own(headers,key);
    if(typeof value==='string')result[key]=value;
    else if(Array.isArray(value)){
      const descriptors=Object.getOwnPropertyDescriptors(value);
      if(Reflect.ownKeys(value).length!==value.length+1)invalid();
      const values=[];for(let index=0;index<value.length;index++){
        const field=descriptors[index];if(!field||!Object.hasOwn(field,'value')||typeof field.value!=='string')invalid();values.push(field.value);
      }result[key]=values;
    }else invalid();
  }return result;
}
function snapshotIngress(req,kind,res){
  const method=req.method,url=req.originalUrl,headers=req.headers;
  const originalHeaders=headerValues(headers);let raw,rawCopy,body,request,originalRequestUtf8,params,challengeId;
  if(kind==='preview'){
    params=req.params;challengeId=own(params,'challengeId');
    if(method!=='GET'||typeof challengeId!=='string'||!uuid.test(challengeId)
      ||url!==base+'/challenges/'+challengeId)invalid();
  }else{
    if(method!=='POST'||url!==(kind==='confirm'?managerOriginalRecoveryApprovalPaths.confirm:managerOriginalRecoveryApprovalPaths.originalStatus))invalid();
    raw=req.scanAuthorityRawBody;body=req.body;
    if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>8192)invalid();
    rawCopy=Buffer.from(raw);
    try{originalRequestUtf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(rawCopy);
      request=decodeRecoveryApprovalRequest(rawCopy);if(!isDeepStrictEqual(validateRecoveryApprovalRequest(body),request))invalid();}
    catch{rawCopy.fill(0);invalid();}
  }
  function assertUnchanged(){
    if(req.method!==method||req.originalUrl!==url||req.headers!==headers
      ||!isDeepStrictEqual(headerValues(req.headers),originalHeaders))
      throw refusal(403,'same_original_recovery_request_changed');
    if(kind==='preview'){
      if(req.params!==params||own(params,'challengeId')!==challengeId)throw refusal(403,'same_original_recovery_request_changed');
    }else if(req.scanAuthorityRawBody!==raw||req.body!==body||!raw.equals(rawCopy)
      ||!isDeepStrictEqual(validateRecoveryApprovalRequest(req.body),request))
      throw refusal(403,'same_original_recovery_request_changed');
    if(req.aborted||res.destroyed||res.writableEnded)
      throw refusal(403,'same_original_recovery_request_closed');
  }
  return {request,originalRequestUtf8,challengeId,assertUnchanged,close(){rawCopy?.fill(0);}};
}
function matchingRequestIssuer(request,values){
  if(request.expected_manager_id!==values.manager_id
    ||request.expected_manager_credential_id!==values.manager_credential_id
    ||request.expected_manager_device_id!==values.manager_device_id)
    throw refusal(403,'same_original_recovery_issuer_changed');
}
function pinnedPreview(raw,request,challengeId){
  const preview=validateRecoveryPreview(raw);
  if(preview.challenge_id!==(request?.challenge_id??challengeId)
    ||(request&&(preview.challenge_sha256!==request.expected_challenge_sha256
      ||preview.preview_sha256!==request.expected_preview_sha256)))
    throw refusal(409,'same_original_recovery_original_conflict');
  return preview;
}
function pinnedReceipt(raw,request,issuer,preview){
  const receipt=validateRecoveryApprovalReceipt(raw);
  if(!isDeepStrictEqual(receipt.original_request,request)||!isDeepStrictEqual(receipt.issuer,issuer)
    ||(preview&&(!isDeepStrictEqual(receipt.original_target,preview.original_target)
      ||recoveryInstantMicros(receipt.expires_at)>recoveryInstantMicros(preview.expires_at))))
    throw refusal(409,'same_original_recovery_original_conflict');
  // Status has no new challenge read or expiry extension. Main's original-only
  // reader must match the persisted target/provenance as well as this request.
  return receipt;
}
function unknown(res,status=503,code='same_original_recovery_unknown'){
  return res.status(status).json({ok:false,outcome:'UNKNOWN',retry_safe:false,code,
    limits:recoveryDeniedEffects});
}
export function createManagerOriginalRecoveryApprovalHandlers({authenticateCurrentManager,
  readVerifiedChallenge,issueOriginalApprovalOnce,readOriginalApproval}={}){
  const ready=[authenticateCurrentManager,readVerifiedChallenge,issueOriginalApprovalOnce,readOriginalApproval]
    .every(port=>typeof port==='function');
  function handler(kind){return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization, Cookie, X-Device-Id');
    if(!ready)return unknown(res,503,'same_original_recovery_unavailable');
    let input,writeInvoked=false;
    try{
      input=snapshotIngress(req,kind,res);const requireCsrf=kind!=='preview';
      async function authenticate(){
        input.assertUnchanged();const current=await authenticateCurrentManager(req,{requireCsrf});
        input.assertUnchanged();return {handle:current,values:issuerValues(current)};
      }
      const original=await authenticate();
      if(input.request)matchingRequestIssuer(input.request,original.values);
      async function assertCurrent(){
        const current=await authenticate();
        if(!isDeepStrictEqual(current.values,original.values))throw refusal(403,'same_original_recovery_issuer_changed');
        // The new handle is comparison only. Ports ALWAYS get original.handle
        // so Main can inspect its private initial auth/session/CSRF capture.
      }
      async function readPreview(challengeId,request){
        let preview,error;
        try{const raw=await readVerifiedChallenge(Object.freeze({challengeId,issuer:original.handle}));
          preview=pinnedPreview(raw,request,challengeId);}catch(cause){error=cause?.code==='same_original_recovery_wire_invalid'
            ?refusal(503,'same_original_recovery_unknown'):cause;}
        await assertCurrent();if(error)throw error;return preview;
      }
      if(kind==='preview'){
        const preview=await readPreview(input.challengeId,null);
        return res.status(200).json({ok:true,data:preview});
      }
      if(kind==='originalStatus'){
        let receipt=null;
        try{const raw=await readOriginalApproval(Object.freeze({originalRequest:input.request,
          originalRequestUtf8:input.originalRequestUtf8,issuer:original.handle}));
          if(raw!==null)receipt=pinnedReceipt(raw,input.request,original.values);}
        catch{/* Missing/partial/foreign read never permits replay or promotion. */}
        await assertCurrent();if(!receipt)return unknown(res);
        return res.status(200).json({ok:true,data:receipt});
      }
      const preview=await readPreview(input.request.challenge_id,input.request);
      // The last current check is immediately before the one issue call. The
      // Main port owns transactional revalidation, deadlines and idempotency.
      input.assertUnchanged();writeInvoked=true;
      let receipt=null;
      try{const raw=await issueOriginalApprovalOnce(Object.freeze({originalRequest:input.request,originalRequestUtf8:input.originalRequestUtf8,
        issuer:original.handle,verifiedPreview:preview}));receipt=pinnedReceipt(raw,input.request,original.values,preview);}
      catch{/* Commit may already have happened. Do not classify as not written. */}
      await assertCurrent();if(!receipt)return unknown(res);
      return res.status(200).json({ok:true,data:receipt});
    }catch(error){
      if(writeInvoked)return unknown(res);
      const status=[400,401,403,409].includes(error?.status)?error.status:503;
      const code=status===400?'same_original_recovery_input_invalid':status===409
        ?'same_original_recovery_original_conflict':status===401||status===403
          ?'same_original_recovery_issuer_denied':'same_original_recovery_unknown';
      return unknown(res,status,code);
    }finally{input?.close();}
  };}
  return Object.freeze({preview:handler('preview'),confirm:handler('confirm'),originalStatus:handler('originalStatus')});
}
