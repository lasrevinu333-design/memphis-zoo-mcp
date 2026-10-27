import {createHash} from 'node:crypto';
import {assertNativeScheduleRequest,deriveNativeScheduleOccurrence} from './native-schedule-occurrence.js';
import {nativeScheduleSnapshotSql} from './native-schedule-preparation.js';
import {readNativeTargetSource} from './native-target-source.js';

// A conservative accepted-source interval candidate, NOT delivery/clock/
// retention authority. The original source-only contract is untouched. A
// future SQL reservation must convert these local values with America/Chicago,
// revalidate current source/principal and bound its actual dispatch/effects.
export const NATIVE_SCHEDULE_VALIDITY_SOURCE_SCHEMA='custodial.native-schedule-validity-source.v1';
const boundary=35100*1000000;
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'
 ?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function localMicros(value){
 const m=/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
 if(!m)throw Error('SOURCE_SHAPE_INVALID');
 const h=Number(m[1]),min=Number(m[2]),sec=Number(m[3]||0),us=Number((m[4]||'').padEnd(6,'0'));
 if(h>24||min>59||sec>59||(h===24&&min+sec+us!==0))throw Error('SOURCE_SHAPE_INVALID');
 return ((h*60+min)*60+sec)*1000000+us;
}
function localText(value){
 if(!Number.isSafeInteger(value)||value<0||value>86400*1000000)throw Error('SOURCE_SHAPE_INVALID');
 const h=Math.floor(value/3600000000),min=Math.floor(value/60000000)%60,sec=Math.floor(value/1000000)%60;
 return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0')+':'+String(sec).padStart(2,'0')+'.'+String(value%1000000).padStart(6,'0');
}
const result=(status,reason,occurrence=null,sourceWindow=null)=>freeze({schema:NATIVE_SCHEDULE_VALIDITY_SOURCE_SCHEMA,status,reason,
 delivery_admitted:false,dispatch_authorized:false,effect_authority:null,retention_authority:null,valid_until:null,
 occurrence,source_window:sourceWindow});
export function deriveNativeScheduleValiditySource(input){
 // Validate original shapes BEFORE cloning: structuredClone alone could erase
 // unsupported prototypes or otherwise turn an invalid source into a DTO.
 const original=deriveNativeScheduleOccurrence(input);
 if(original.status!=='POLICY_AUTHORITY_REQUIRED')return result(original.status,original.reason);
 let copy,report;
 try{copy=structuredClone(input);report=deriveNativeScheduleOccurrence(copy);}
 catch{return result('SOURCE_UNAVAILABLE','SOURCE_SHAPE_INVALID');}
 if(canonical(report)!==canonical(original))return result('SOURCE_UNAVAILABLE','TARGET_CHANGED');
 const employee=copy.request.employeeId,edges=[];
 const add=row=>{for(const field of ['coverage_start','coverage_end']){
  const value=localMicros(row[field]);if(value>boundary)edges.push(value);
 }};
 try{
  // Ending an accepted segment or entering/leaving an accepted loan can change
  // responsibility. Stop at the earliest relevant source edge, including a
  // future responsibility start. Do not extend across that edge merely because
  // a later segment looks like the same owner; revalidation is separate.
  for(const row of copy.snapshot.segments)if(row.assigned_employee_id===employee)add(row);
  for(const row of copy.snapshot.physical)if(row.assigned_employee_id===employee)add(row);
  for(const row of copy.snapshot.lunch)if(row.normal_owner_id===employee||row.coverer_id===employee)add(row);
 }catch{return result('SOURCE_UNAVAILABLE','SOURCE_SHAPE_INVALID');}
 if(!edges.length)return result('SOURCE_WINDOW_UNAVAILABLE','NO_BOUND_RESPONSIBILITY_EDGE',report.occurrence);
 const cutoff=Math.min(...edges);
 const window={schema:'custodial.native-schedule-conservative-source-window.v1',service_date:copy.request.serviceDate,
  timezone:'America/Chicago',employee_id:employee,generation_id:copy.request.generationId,
  logical_key:report.occurrence.logical_key,semantic_sha256:report.occurrence.semantic_sha256,source_sha256:report.occurrence.source_sha256,
  valid_from_local:'09:45:00.000000',valid_until_local:localText(cutoff),
  cutoff_rule:'FIRST_FUTURE_ACCEPTED_RECIPIENT_RESPONSIBILITY_SOURCE_EDGE',
  scope:'Conservative source candidate; no UTC/clock/retention/delivery admission'};
 return result('SOURCE_WINDOW_PREPARED_NOT_ADMITTED','CONSERVATIVE_ACCEPTED_SOURCE_ONLY',report.occurrence,
  {...window,source_window_sha256:digest(window)});
}

export async function prepareNativeScheduleValiditySource({runReadOnlySql,runRpc,sourceKey,employeeId,generationId,serviceDate}){
 const request={sourceKey,employeeId,generationId,serviceDate};assertNativeScheduleRequest(request);
 if(typeof runReadOnlySql!=='function'||typeof runRpc!=='function')throw Object.assign(new Error('REQUEST_INVALID'),{code:'REQUEST_INVALID'});
 try{
  const read=()=>readNativeTargetSource({runRpc,kind:'SCHEDULE',sourceKey,employeeId,generationId});
  const targetBefore=structuredClone(await read());
  if(targetBefore.status!=='SOURCE_ONLY_POLICY_MISSING')return result('SOURCE_UNAVAILABLE','TARGET_UNAVAILABLE');
  const rows=await runReadOnlySql(nativeScheduleSnapshotSql(serviceDate));
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).join()!=='data')return result('SOURCE_UNAVAILABLE','SOURCE_SHAPE_INVALID');
  // Snapshot before the second await, just like the existing occurrence reader.
  const snapshot=structuredClone(rows[0].data),targetAfter=structuredClone(await read());
  return deriveNativeScheduleValiditySource({request,snapshot,targetBefore,targetAfter});
 }catch{return result('SOURCE_UNAVAILABLE','READ_UNAVAILABLE');}
}
