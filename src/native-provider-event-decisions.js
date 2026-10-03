import {isDeepStrictEqual} from 'node:util';
import {validateNativeProviderEventsRequest,validateNativeProviderEventsResponse} from './native-provider-events.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const fail=(code='native_provider_event_decision_contract_invalid',status=400)=>{throw Object.assign(new Error(code),{code,status});};
export const NATIVE_PROVIDER_EVENT_DECISION_QUERY='custodial.native-provider-event-decision-query.v1';
export const NATIVE_PROVIDER_EVENT_DECISIONS='custodial.native-provider-event-decisions.v1';
const requesterKeys=['current_generation_id','credential_id','employee_id','device_id','assignment_epoch','principal_digest','token_digest'];

/** Query only already-durable originals. Current and original generations are
 * distinct: token rotation never rewrites the queried original event. */
export function validateNativeProviderEventDecisionQuery(body){
 if(!exact(body,['schema','requester','events'])||body.schema!==NATIVE_PROVIDER_EVENT_DECISION_QUERY
  ||!exact(body.requester,requesterKeys)||Buffer.byteLength(JSON.stringify(body))>65536)fail();
 const r=body.requester;
 for(const key of ['current_generation_id','credential_id','employee_id'])if(typeof r[key]!=='string'||!UUID.test(r[key]))fail();
 for(const key of ['principal_digest','token_digest'])if(typeof r[key]!=='string'||!SHA.test(r[key]))fail();
 if(typeof r.device_id!=='string'||!/^KIOSK_(?:0[2-9]|10)$/.test(r.device_id)||!Number.isSafeInteger(r.assignment_epoch)||r.assignment_epoch<1)fail();
 const batch=validateNativeProviderEventsRequest({schema:'custodial.native-provider-events.v2',events:body.events});
 for(const e of batch.events)for(const [key,original]of [['credential_id','receipt_credential_id'],['employee_id','receipt_employee_id'],
  ['device_id','receipt_device_id'],['assignment_epoch','receipt_assignment_epoch'],['principal_digest','principal_digest']])if(r[key]!==e[original])fail();
 return Object.freeze({schema:body.schema,requester:Object.freeze({...r}),events:batch.events});
}
function proof(value,body){
 if(!exact(value,['credentialId','credentialHash','nativeRequestId','attestationDigest','rawBodySha256'])
  ||value.credentialId!==body.requester.credential_id||typeof value.credentialId!=='string'||!UUID.test(value.credentialId)
  ||typeof value.nativeRequestId!=='string'||!UUID.test(value.nativeRequestId))fail();
 for(const key of ['credentialHash','attestationDigest','rawBodySha256'])if(typeof value[key]!=='string'||!SHA.test(value[key]))fail();
 return Object.freeze({...value});
}
/** A missing item is still pending. UNRESOLVED has no receipt, expiry,
 * permanent-denial reason or cleanup authority. A positive result must be the
 * existing exact accepted echo, not a new event or an inferred success. */
export function validateNativeProviderEventDecisions(value,request,context){
 const body=validateNativeProviderEventDecisionQuery(request),p=proof(context,body),events=new Map(body.events.map(e=>[e.event_id,e]));
 if(!exact(value,['ok','data'])||value.ok!==true||!exact(value.data,['schema','native_request_id','request_body_sha256','requester','results'])
  ||value.data.schema!==NATIVE_PROVIDER_EVENT_DECISIONS||value.data.native_request_id!==p.nativeRequestId
  ||value.data.request_body_sha256!==p.rawBodySha256||!isDeepStrictEqual(value.data.requester,body.requester)
  ||!Array.isArray(value.data.results)||value.data.results.length>16||Buffer.byteLength(JSON.stringify(value))>262144)fail();
 const seen=new Set(),results=[];
 for(const result of value.data.results){
  const e=events.get(result?.event_id);if(!e||seen.has(result.event_id))fail();seen.add(result.event_id);
  if(result.decision==='UNRESOLVED'){
   if(!exact(result,['event_id','decision']))fail();results.push(Object.freeze({...result}));continue;
  }
  if(!exact(result,['event_id','decision','receipt'])||result.decision!=='ORIGINAL_ACCEPTED'||result.receipt?.replayed!==true)fail();
  const checked=validateNativeProviderEventsResponse({ok:true,data:{schema:'custodial.native-provider-event-receipts.v2',results:[result.receipt]}},
   {schema:'custodial.native-provider-events.v2',events:[e]});
  if(checked.data.results[0]?.admitted_state!=='ACCEPTED')fail();
  results.push(Object.freeze({event_id:e.event_id,decision:result.decision,receipt:checked.data.results[0]}));
 }
 return Object.freeze({ok:true,data:Object.freeze({schema:value.data.schema,native_request_id:p.nativeRequestId,
  request_body_sha256:p.rawBodySha256,requester:body.requester,results:Object.freeze(results)})});
}

/** Server-only adapter called after the actual route authenticates current
 * credential + raw-body HMAC. SQL performs its own current/original binding
 * checks. No table read fallback and no synthesized decision on RPC failure. */
export async function lookupNativeProviderEventDecisions({db,body:input,context:inputContext}){
 const body=validateNativeProviderEventDecisionQuery(input),context=proof(inputContext,body);
 if(!db||typeof db.rpc!=='function')fail('native_provider_service_unavailable',503);
 let result;
 try{result=await db.rpc('custodial_native_provider_event_decisions',{
   p_credential:context.credentialId,p_credential_hash:context.credentialHash,p_native_request:context.nativeRequestId,
   p_attestation_digest:context.attestationDigest,p_raw_body_sha256:context.rawBodySha256,p_body:body,
  });}
 catch{fail('native_provider_service_unavailable',503);}
 if(result?.error){const status=result.error.code==='42501'?403:result.error.code==='22023'?400:503;
  fail(status===403?'native_provider_access_denied':status===400?'native_provider_request_invalid':'native_provider_service_unavailable',status);}
 try{return validateNativeProviderEventDecisions(result?.data,body,context);}
 catch{fail('native_provider_response_invalid',503);}
}
