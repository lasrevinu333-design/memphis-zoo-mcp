import {isDeepStrictEqual} from 'node:util';
import {validateNativeLocationRecipient} from './native-location-reservation.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(k=>typeof k==='string'
 &&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...keys].sort());
const invalid=()=>{throw new Error('native_schedule_job_contract_invalid');};
function instant(v){
 const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)invalid();
 const[y,mo,d,h,mi,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||s>59)invalid();return v;
}
export async function prepareNativeScheduleJob({db,sourceReservationId,operationId,expected}){
 const original=validateNativeLocationRecipient(expected);
 if(typeof sourceReservationId!=='string'||typeof operationId!=='string'||!UUID.test(sourceReservationId)||!UUID.test(operationId)||typeof db?.rpc!=='function')invalid();
 let result;try{result=await db.rpc('custodial_native_schedule_job_prepare',{p_source:sourceReservationId,p_expected:original,p_operation:operationId});}
 catch{return Object.freeze({status:'JOB_PREPARATION_PENDING',dispatch_authorized:false,delivery_admitted:false,job:null});}
 if(result?.error)return Object.freeze({status:'JOB_PREPARATION_PENDING',dispatch_authorized:false,delivery_admitted:false,job:null});
 const v=result?.data;
 if(!exact(v,['schema','status','prepared','replayed','dispatch_authorized','delivery_admitted','job'])
  ||v.schema!=='custodial.native-schedule-job-preparation.v1'||v.dispatch_authorized!==false||v.delivery_admitted!==false
  ||typeof v.prepared!=='boolean'||typeof v.replayed!=='boolean')invalid();
 if(v.prepared===false){
  if(v.replayed!==false||v.job!==null||!['ORIGINAL_JOB_CONFLICT','SOURCE_OR_ACTOR_SUPERSEDED','UNOWNED_JOB_CONFLICT'].includes(v.status))invalid();
  return Object.freeze({...v});
 }
 const j=v.job;
 if(v.status!==(v.replayed?'ORIGINAL_JOB_RETAINED':'JOB_PREPARED_NATIVE_UNQUALIFIED')
  ||!exact(j,['job_id','operation_id','source_reservation_id','prepared_at','payload_sha256','source_window_sha256'])
  ||Object.values(j).some(x=>typeof x!=='string')||![j.job_id,j.operation_id,j.source_reservation_id].every(x=>UUID.test(x))
  ||![j.payload_sha256,j.source_window_sha256].every(x=>SHA.test(x))||j.source_reservation_id!==sourceReservationId
  ||(!v.replayed&&j.operation_id!==operationId))invalid();
 instant(j.prepared_at);
 return Object.freeze({...v,job:Object.freeze({...j})});
}

// Source-bound job preparation is not permission to use a legacy sender.
// No sender factory/profile/route is installed by this preparation stage.
export function holdUnqualifiedNativeScheduleJob(job){
 if(job?.payload_json?.data_json?.kind==='employee_schedule_ownership'
  ||(typeof job?.job_key==='string'&&job.job_key.startsWith('employee-schedule-push:'))){
  throw Object.assign(new Error('native_schedule_delivery_unqualified'),{
   code:'native_schedule_delivery_unqualified',deferFinish:true,terminal:false,permanent:false,
  });
 }
}
