import {isDeepStrictEqual,types} from 'node:util';
import {parseNativeProviderJson} from './native-provider-json.js';
import {inventorySeparationApi as base,inventorySeparationDeniedEffects,
 validateInventorySeparationRequest,validateInventorySeparationReview,
 validateInventorySeparationReceipt} from './original-inventory-separation-wire.js';

export const managerOriginalInventorySeparationPaths=Object.freeze({preview:base+'/reviews/:nativeRequestId',
 confirm:base+'/approvals',originalStatus:base+'/approvals/original-status'});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const actorKeys=['manager_id','manager_credential_id','manager_device_id'];
const sessionKeys=['signed_session_sha256','signed_session_expires_at','security_session_id','security_password_version',
 'security_token_hash','security_csrf_hash','confirmation_csrf_verified','security_session_expires_at'];
const refuse=(status,code)=>Object.assign(new Error(code),{status,code});
function own(value,key){
 if(!value||typeof value!=='object'||types.isProxy(value))throw refuse(400,'input_invalid');
 const d=Object.getOwnPropertyDescriptor(value,key);
 if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw refuse(400,'input_invalid');return d.value;
}
function headers(value){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)throw refuse(400,'input_invalid');
 const out={};for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||key==='__proto__')throw refuse(400,'input_invalid');
  const v=own(value,key);
  if(typeof v==='string')out[key]=v;
  else if(Array.isArray(v)&&Reflect.ownKeys(v).length===v.length+1){
   out[key]=Array.from({length:v.length},(_,i)=>{const x=own(v,String(i));if(typeof x!=='string')throw refuse(400,'input_invalid');return x;});
  }else throw refuse(400,'input_invalid');
 }return out;
}
function snapshot(req,res,kind){
 const method=req.method,url=req.originalUrl,headerObject=req.headers,headerCopy=headers(headerObject);
 let raw,copy,body,request,originalRequestUtf8,params,nativeRequestId;
 if(kind==='preview'){
  params=req.params;nativeRequestId=own(params,'nativeRequestId');
  if(method!=='GET'||typeof nativeRequestId!=='string'||!uuid.test(nativeRequestId)||url!==base+'/reviews/'+nativeRequestId)
   throw refuse(400,'input_invalid');
 }else{
  if(method!=='POST'||url!==(kind==='confirm'?managerOriginalInventorySeparationPaths.confirm:managerOriginalInventorySeparationPaths.originalStatus))
   throw refuse(400,'input_invalid');
  raw=req.scanAuthorityRawBody;body=req.body;
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>8192)throw refuse(400,'input_invalid');
  copy=Buffer.from(raw);
  try{originalRequestUtf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(copy);
   request=validateInventorySeparationRequest(parseNativeProviderJson(copy));
   if(!isDeepStrictEqual(validateInventorySeparationRequest(body),request))throw new Error('body_changed');
  }catch{copy.fill(0);throw refuse(400,'input_invalid');}
 }
 function current(){
  if(req.method!==method||req.originalUrl!==url||req.headers!==headerObject||!isDeepStrictEqual(headers(req.headers),headerCopy))
   throw refuse(403,'request_changed');
  if(kind==='preview'){
   if(req.params!==params||own(params,'nativeRequestId')!==nativeRequestId)throw refuse(403,'request_changed');
  }else if(req.scanAuthorityRawBody!==raw||req.body!==body||!raw.equals(copy)
   ||!isDeepStrictEqual(validateInventorySeparationRequest(req.body),request))throw refuse(403,'request_changed');
  if(req.aborted||res.destroyed||res.writableEnded)throw refuse(403,'request_closed');
 }
 return {request,originalRequestUtf8,nativeRequestId,current,close(){copy?.fill(0);}};
}
function unknown(res,status=503,code='original_inventory_separation_unknown'){
 if(res.destroyed||res.headersSent||res.writableEnded)return;
 return res.status(status).json({ok:false,outcome:'UNKNOWN',retry_safe:false,code,limits:inventorySeparationDeniedEffects});
}

// These private ports are supplied ONLY by Main's closed normal-auth
// composition. No request/body issuer, flag or review JSON can create authority.
export function createManagerOriginalInventorySeparationHandlers({authenticateCurrentManager,inspectAuthenticatedIssuer,
 readVerifiedInventory,issueOriginalInventoryApprovalOnce,readOriginalInventoryApproval}={}){
 const ready=[authenticateCurrentManager,inspectAuthenticatedIssuer,readVerifiedInventory,
  issueOriginalInventoryApprovalOnce,readOriginalInventoryApproval].every(f=>typeof f==='function'&&!types.isProxy(f));
 function handler(kind){return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization, Cookie, X-Device-Id');
  if(!ready)return unknown(res,503,'original_inventory_separation_unavailable');
  let input,writeInvoked=false;
  try{
   input=snapshot(req,res,kind);const requireCsrf=kind!=='preview';
   async function auth(){
    input.current();const issuer=await authenticateCurrentManager(req,{requireCsrf});input.current();
    if(!issuer||types.isProxy(issuer)||!Object.isFrozen(issuer)||Object.getPrototypeOf(issuer)!==Object.prototype
     ||!isDeepStrictEqual(Reflect.ownKeys(issuer).sort(),[...actorKeys].sort()))throw refuse(403,'issuer_denied');
    const actor=Object.fromEntries(actorKeys.map(k=>[k,own(issuer,k)]));
    if(!uuid.test(actor.manager_id)||!uuid.test(actor.manager_credential_id)||typeof actor.manager_device_id!=='string'
     ||!/^[A-Za-z0-9_-]{1,128}$/.test(actor.manager_device_id))throw refuse(403,'issuer_denied');
    const binding=inspectAuthenticatedIssuer(issuer);
    if(!binding||binding.issuer!==issuer||binding.observation_only!==true||binding.transaction_authority!==false
     ||requireCsrf&&binding.confirmation_csrf_verified!==true)throw refuse(403,'issuer_denied');
    const session=Object.fromEntries(sessionKeys.map(k=>[k,own(binding,k)]));
    return {issuer,actor,session};
   }
   const initial=await auth();
   async function current(){const again=await auth();
    if(!isDeepStrictEqual(again.actor,initial.actor)||!isDeepStrictEqual(again.session,initial.session))throw refuse(403,'issuer_changed');}
   const request=input.request;
   if(request&&(request.expected_manager_id!==initial.actor.manager_id
    ||request.expected_manager_credential_id!==initial.actor.manager_credential_id
    ||request.expected_manager_device_id!==initial.actor.manager_device_id))throw refuse(403,'issuer_changed');
   function receipt(raw,review){
    const value=validateInventorySeparationReceipt(raw);
    if(!isDeepStrictEqual(value.original_request,request)||!isDeepStrictEqual(value.issuer,initial.actor)
     ||review&&(!isDeepStrictEqual(value.original_target,review.original_target)
      ||value.expires_at>review.expires_at||value.approved_at<review.reviewed_at))throw refuse(409,'original_conflict');
    return value;
   }
   if(kind==='originalStatus'){
    let result=null;
    try{const raw=await readOriginalInventoryApproval(Object.freeze({originalRequest:request,
     originalRequestUtf8:input.originalRequestUtf8,issuer:initial.issuer}));if(raw!==null)result=receipt(raw);}
    catch{/* A missing/ambiguous historical read NEVER authorizes resend. */}
    await current();return result?res.status(200).json({ok:true,data:result}):unknown(res);
   }
   let review,originalReview,error;
   try{originalReview=await readVerifiedInventory(Object.freeze({
    nativeRequestId:request?.native_request_id??input.nativeRequestId,issuer:initial.issuer}));
    review=validateInventorySeparationReview(originalReview);
    if(review.native_request_id!==(request?.native_request_id??input.nativeRequestId)
     ||!isDeepStrictEqual(review.issuer,initial.actor))throw refuse(409,'original_conflict');
    if(request&&(request.expected_review_sha256!==review.review_sha256
     ||request.expected_inventory_manifest_sha256!==review.inventory_manifest_sha256
     ||request.expected_registration_receipt_sha256!==review.registration_receipt_sha256
     ||request.expected_separation_authority_revision!==review.original_target.separation_authority_revision))throw refuse(409,'original_conflict');
   }catch(cause){error=cause;}
   await current();if(error)throw error;
   if(kind==='preview')return res.status(200).json({ok:true,data:review});
   input.current();writeInvoked=true;let result=null;
   try{result=receipt(await issueOriginalInventoryApprovalOnce(Object.freeze({originalRequest:request,
    originalRequestUtf8:input.originalRequestUtf8,issuer:initial.issuer,verifiedReview:originalReview})),review);}
   catch{/* The SQL commit may exist. Do not turn uncertainty into new authority. */}
   await current();return result?res.status(200).json({ok:true,data:result}):unknown(res);
  }catch(error){
   if(writeInvoked)return unknown(res);
   const status=[400,401,403,409].includes(error?.status)?error.status:503;
   return unknown(res,status,status===400?'original_inventory_separation_input_invalid':status===409?
    'original_inventory_separation_original_conflict':status===401||status===403?
    'original_inventory_separation_issuer_denied':'original_inventory_separation_unknown');
  }finally{input?.close();}
 };}
 return Object.freeze({preview:handler('preview'),confirm:handler('confirm'),originalStatus:handler('originalStatus')});
}
