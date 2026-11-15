import {isDeepStrictEqual} from 'node:util';
import {validateNativeScheduleSourceRequests} from './native-schedule-source-discovery.js';
import {validateNativeLocationRecipient} from './native-location-reservation.js';
import {prepareNativeScheduleContent} from './native-schedule-delivery-preparation.js';
import {prepareNativeScheduleJob} from './native-schedule-job-preparation.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const exact=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(x=>typeof x==='string'
 &&Object.getOwnPropertyDescriptor(v,x)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,x),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...k].sort());
const invalid=()=>{throw Object.assign(new Error('native_schedule_source_orchestration_invalid'),{code:'native_schedule_source_orchestration_invalid'});};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function context(discovery,request){
 const d=validateNativeScheduleSourceRequests(discovery);
 if(d.status!=='SOURCE_CANDIDATES_ONLY'||!exact(request,['source_key','employee_id','generation_id'])
  ||!d.requests.some(r=>isDeepStrictEqual(r,request)))invalid();
 return freeze({discovery:d,request:structuredClone(request)});
}
export function validateNativeSchedulePreparationSource(v,{discovery,request}){
 const c=context(discovery,request);
 if(!exact(v,['schema','status','source_status','dispatch_authorized','delivery_admitted','clock_effect_authority','retention_authority','preparation'])
  ||v.schema!=='custodial.native-schedule-preparation-source.v1'||v.dispatch_authorized!==false||v.delivery_admitted!==false
  ||v.clock_effect_authority!==null||v.retention_authority!==null)invalid();
 if(v.status==='SOURCE_NOT_CURRENT'){
  if(v.preparation!==null||!['TARGET_STALE','SOURCE_STALE','WINDOW_NOT_STARTED','SOURCE_WINDOW_EXPIRED','NO_OWNERSHIP_CHANGE'].includes(v.source_status))invalid();
  return freeze(structuredClone(v));
 }
 const p=v.preparation;
 if(v.status!=='CURRENT_PREPARATION_SOURCE_ONLY'||v.source_status!=='CURRENT_WINDOW_SOURCE_ONLY'||!exact(p,['source_key','employee_id','generation_id','service_date','projection_id','publication_id','version_id','source_revision','expected_source_sha256','expected'])
  ||!['source_key','employee_id','generation_id'].every(k=>p[k]===c.request[k])||p.service_date!==c.discovery.service_date
  ||!['projection_id','publication_id','version_id','source_revision'].every(k=>p[k]===c.discovery.authority[k])
  ||typeof p.expected_source_sha256!=='string'||!SHA.test(p.expected_source_sha256)
  ||!exact(p.expected,['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']))invalid();
 const expected=validateNativeLocationRecipient(p.expected);
 if(expected.employee_id!==p.employee_id||expected.generation_id!==p.generation_id)invalid();
 return freeze(structuredClone(v));
}
// Every write below uses the existing
// typed source/job RPCs; all native qualification/send permissions stay false.
export async function prepareDiscoveredNativeScheduleJob({db,discovery,request,sourceOperationId,jobOperationId}){
 const c=context(discovery,request);
 if(typeof db?.rpc!=='function'||![sourceOperationId,jobOperationId].every(x=>typeof x==='string'&&UUID.test(x)))invalid();
 const pending=reason=>freeze({schema:'custodial.native-schedule-source-orchestration.v1',status:'SOURCE_JOB_PENDING',reason,
  dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null,job:null});
 let r;try{r=await db.rpc('custodial_native_schedule_preparation_source',{p_source:c.request.source_key,p_employee:c.request.employee_id,p_generation:c.request.generation_id});}
 catch{return pending('PREPARATION_SOURCE_UNAVAILABLE');}
 if(r?.error)return pending('PREPARATION_SOURCE_UNAVAILABLE');
 const source=validateNativeSchedulePreparationSource(r?.data,c);
 if(source.status!=='CURRENT_PREPARATION_SOURCE_ONLY')return pending(source.source_status);
 const p=source.preparation;
 const content=await prepareNativeScheduleContent({db,sourceKey:p.source_key,employeeId:p.employee_id,generationId:p.generation_id,
  expectedSourceSha256:p.expected_source_sha256,operationId:sourceOperationId});
 if(content.status!=='CONTENT_PREPARED_NATIVE_UNQUALIFIED')return pending(content.reason);
 const candidate=content.candidate;
 if(candidate.server_source_sha256!==p.expected_source_sha256||candidate.service_date!==p.service_date
  ||!['projection_id','publication_id','version_id','source_revision'].every(k=>candidate[k]===p[k])
  ||candidate.employee_id!==p.employee_id||candidate.generation_id!==p.generation_id||candidate.assignment_occurrence_id!==p.source_key)invalid();
 const receipt=await prepareNativeScheduleJob({db,sourceReservationId:candidate.source_reservation_id,operationId:jobOperationId,expected:p.expected});
 if(receipt.prepared!==true)return pending(receipt.status);
 return freeze({schema:'custodial.native-schedule-source-orchestration.v1',status:'SOURCE_JOB_PREPARED_NATIVE_UNQUALIFIED',
  dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null,
  source_operation_id:candidate.source_operation_id,source_reservation_id:candidate.source_reservation_id,job:receipt.job,replayed:receipt.replayed});
}
