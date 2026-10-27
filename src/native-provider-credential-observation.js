import {isDeepStrictEqual} from 'node:util';
import {authenticateNativeProviderCredentialObservationRequest} from './auth/device-credential-auth.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const fail=(code='native_credential_observation_contract_invalid',status=400)=>{throw Object.assign(new Error(code),{code,status});};
export const CREDENTIAL_OBSERVATION_QUERY='custodial.native-provider-credential-observation-query.v1';
export const CREDENTIAL_OBSERVATION='custodial.native-provider-credential-observation.v1';
const requesterKeys=['current_generation_id','credential_id','employee_id','device_id','assignment_epoch','principal_digest','token_digest'];
export function validateNativeProviderCredentialObservationQuery(body){
 if(!exact(body,['schema','requester'])||body.schema!==CREDENTIAL_OBSERVATION_QUERY
  ||!exact(body.requester,requesterKeys)||Buffer.byteLength(JSON.stringify(body))>65536)fail();
 const r=body.requester;
 for(const key of ['current_generation_id','credential_id','employee_id'])if(typeof r[key]!=='string'||!UUID.test(r[key]))fail();
 for(const key of ['principal_digest','token_digest'])if(typeof r[key]!=='string'||!SHA.test(r[key]))fail();
 if(typeof r.device_id!=='string'||!/^KIOSK_(?:0[2-9]|10)$/.test(r.device_id)||!Number.isSafeInteger(r.assignment_epoch)||r.assignment_epoch<1)fail();
 return Object.freeze({schema:body.schema,requester:Object.freeze({...r})});
}
function proof(p){
 if(!exact(p,['purpose','body','credentialId','credentialHash','credentialSecretKeyId','nativeRequestId','attestationDigest','rawBodySha256'])
  ||p.purpose!=='NATIVE_CREDENTIAL_OBSERVATION_ONLY'||typeof p.credentialId!=='string'||!UUID.test(p.credentialId)
  ||typeof p.nativeRequestId!=='string'||!UUID.test(p.nativeRequestId))fail();
 for(const k of ['credentialHash','credentialSecretKeyId','attestationDigest','rawBodySha256'])if(typeof p[k]!=='string'||!SHA.test(p[k]))fail();
 const body=validateNativeProviderCredentialObservationQuery(p.body);if(body.requester.credential_id!==p.credentialId)fail();
 return Object.freeze({...p,body});
}
// Same Gregorian, canonical six-fraction SQL timestamp grammar as existing
// native receipts. Lexical comparison is exact here; never Date rounding/time authority.
function time(v){
 const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)fail();
 const[y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)fail();return v;
}
export function validateNativeProviderCredentialObservation(value,inputProof){
 const p=proof(inputProof),d=value?.data;
 if(!exact(value,['ok','data'])||value.ok!==true||!exact(d,['schema','native_request_id','request_body_sha256','requester',
  'decision','observed_at','credential_expires_at','credential_revoked_at'])||d.schema!==CREDENTIAL_OBSERVATION
  ||d.native_request_id!==p.nativeRequestId||d.request_body_sha256!==p.rawBodySha256||!isDeepStrictEqual(d.requester,p.body.requester))fail();
 if(d.decision==='UNRESOLVED'){
  if(d.observed_at!==null||d.credential_expires_at!==null||d.credential_revoked_at!==null)fail();
 }else{
  const observed=time(d.observed_at),expiry=time(d.credential_expires_at);
  if(d.decision==='CURRENT_AS_OF'){if(expiry<=observed||d.credential_revoked_at!==null)fail();}
  else if(d.decision==='EXPIRED_AS_OF'){if(expiry>observed||d.credential_revoked_at!==null)fail();}
  else if(d.decision==='REVOKED_AS_OF'){if(time(d.credential_revoked_at)>observed)fail();}
  else fail();
 }
 return Object.freeze({ok:true,data:Object.freeze({...d,requester:p.body.requester})});
}
/** Service-only observation, NOT clock sampling, dispatch or permanent cleanup.
 * Captured/frozen arguments survive caller mutation across the RPC await. */
export async function lookupNativeProviderCredentialObservation({db,context}){
 const p=proof(context);
 if(!db||typeof db.rpc!=='function')fail('native_credential_observation_unavailable',503);
 const args=Object.freeze({p_credential:p.credentialId,p_credential_hash:p.credentialHash,p_credential_secret_key_id:p.credentialSecretKeyId,
  p_native_request:p.nativeRequestId,p_attestation_digest:p.attestationDigest,p_raw_body_sha256:p.rawBodySha256,p_body:p.body});
 let result;try{result=await db.rpc('custodial_native_provider_credential_observation',args);}catch{fail('native_credential_observation_unavailable',503);}
 if(result?.error){const status=result.error.code==='42501'?403:result.error.code==='22023'?400:503;
  fail(status===403?'native_credential_observation_access_denied':status===400?'native_credential_observation_request_invalid':'native_credential_observation_unavailable',status);}
 try{return validateNativeProviderCredentialObservation(result?.data,p);}catch{fail('native_credential_observation_response_invalid',503);}
}
/** Unmounted callable seam only. Existing provider route/parser/index unchanged.
 * Never substitutes memphisDeviceAuth.credentialed for this dedicated proof. */
export function createNativeProviderCredentialObservationHandler({db,env=process.env,store,runReadOnlySql,now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   const context=await authenticateNativeProviderCredentialObservationRequest(req,{env,store,runReadOnlySql,...(now?{now:now()}: {})});
   return res.json(await lookupNativeProviderCredentialObservation({db,context}));
  }catch(error){
   const status=[400,403,503].includes(error?.status)?error.status:503;
   const code=status===400?'native_credential_observation_request_invalid':status===403?'native_credential_observation_proof_invalid':'native_credential_observation_unavailable';
   return res.status(status).json({ok:false,code});
  }
 };
}
