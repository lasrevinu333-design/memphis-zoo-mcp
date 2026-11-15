import {randomUUID} from 'node:crypto';
import {readNativeScheduleSourceRequests} from './native-schedule-source-discovery.js';
import {prepareDiscoveredNativeScheduleJob} from './native-schedule-source-orchestration.js';
// Client I/O budget only; it does not define cue timing or extend SQL validity.
export const NATIVE_SCHEDULE_PREPARATION_BUDGET_MS=10_000;
const allowed=new Set(['custodial_native_schedule_source_requests','custodial_native_schedule_preparation_source',
 'custodial_native_schedule_source_reserve','custodial_native_schedule_content_source','custodial_native_schedule_job_prepare']);
const skipped=new Set(['NO_OWNERSHIP_CHANGE','SOURCE_WINDOW_EXPIRED']);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function boundedNativeScheduleSourceDb(db,signal){
 if(typeof db?.rpc!=='function'||typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function')throw Error('native_schedule_source_rpc_unavailable');
 return Object.freeze({rpc(fn,args){
  if(!allowed.has(fn)||signal.aborted)throw Error('native_schedule_source_rpc_budget_or_contract');
  const builder=db.rpc(fn,args);
  // Require the pinned SDK's lazy request controls. Never fall back to an
  // unbounded request or automatically replay an uncertain source write.
  if(typeof builder?.abortSignal!=='function'||typeof builder?.retry!=='function')throw Error('native_schedule_source_rpc_capability_unavailable');
  return builder.retry(false).abortSignal(signal);
 }});
}
export async function prepareNativeScheduleSourceJobs({db}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),NATIVE_SCHEDULE_PREPARATION_BUDGET_MS);timer.unref?.();
 const base={schema:'custodial.native-schedule-source-producer.v1',dispatch_authorized:false,delivery_admitted:false,
  clock_effect_authority:null,retention_authority:null,native_qualified:false};
 let requested=null,prepared=0,replayed=0,pending=0,skip=0;const jobs=[],reasons=[];
 try{
  const sourceDb=boundedNativeScheduleSourceDb(db,controller.signal),discovery=await readNativeScheduleSourceRequests({db:sourceDb});
  if(discovery.status!=='SOURCE_CANDIDATES_ONLY')return freeze({...base,status:discovery.status,requested:null,prepared,replayed,pending:null,skipped:skip,jobs,reasons:[discovery.status]});
  requested=discovery.requests.length;
  for(const request of discovery.requests){
   if(controller.signal.aborted){pending++;reasons.push('SOURCE_RPC_BUDGET');continue;}
   let r;try{r=await prepareDiscoveredNativeScheduleJob({db:sourceDb,discovery,request,sourceOperationId:randomUUID(),jobOperationId:randomUUID()});}
   catch{pending++;reasons.push('SOURCE_PREPARATION_INVALID');continue;}
   if(r.status==='SOURCE_JOB_PREPARED_NATIVE_UNQUALIFIED'){
    prepared++;if(r.replayed)replayed++;jobs.push({job_id:r.job.job_id,source_reservation_id:r.source_reservation_id,replayed:r.replayed});
   }else if(skipped.has(r.reason)){skip++;reasons.push(r.reason);}
   else{pending++;reasons.push(controller.signal.aborted?'SOURCE_RPC_BUDGET':r.reason);}
  }
  return freeze({...base,status:requested===0?'NO_SOURCE_REQUESTS':pending?'SOURCE_PREPARATION_PENDING':prepared===0?'NO_NEW_SOURCE_JOBS':'SOURCE_JOBS_PREPARED_NATIVE_UNQUALIFIED',
   requested,prepared,replayed,pending,skipped:skip,jobs,reasons});
 }catch{return freeze({...base,status:'SOURCE_PREPARATION_FAILED',requested,prepared,replayed,pending:requested===null?null:requested-prepared-skip,skipped:skip,jobs,reasons:['SOURCE_CONTRACT_INVALID']});}
 finally{clearTimeout(timer);controller.abort();}
}
