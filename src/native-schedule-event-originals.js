import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {isNativeScheduleEvent,NATIVE_SCHEDULE_OBSERVATION_ORIGINAL_FIELDS} from './native-provider-events.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype
 &&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...keys].sort());
const fail=(code='native_provider_schedule_original_pending',status=503)=>{throw Object.assign(new Error(code),{code,status});};
/** Called only after current credential, recipient and raw-body native HMAC.
 * Missing originals stay PENDING: no fabricated source ID, receipt, accepted
 * result, cleanup authorization, table-read fallback or provider permission. */
export async function loadNativeScheduleEventOriginals({db,events,credentialId,credentialHash}){
 if(!Array.isArray(events)||events.length<1||events.length>16||Array.from({length:events.length},(_,i)=>i).some(i=>!Object.hasOwn(events,i)))fail();
 const wanted=events.filter(isNativeScheduleEvent),jobs=[...new Set(wanted.map(x=>x.receipt_job_id))].sort();
 if(!jobs.length)return new Map();
 if(jobs.length>16||!jobs.every(x=>typeof x==='string'&&UUID.test(x))||typeof credentialId!=='string'||typeof credentialHash!=='string'||!UUID.test(credentialId)||!SHA.test(credentialHash)
  ||wanted.some(x=>x.receipt_credential_id!==credentialId)||typeof db?.rpc!=='function')fail();
 let result;try{result=await db.rpc('custodial_native_schedule_observation_originals',{
  p_credential:credentialId,p_credential_hash:credentialHash,p_jobs:jobs,
 });}catch{fail();}
 if(result?.error){if(result.error.code==='42501')fail('native_provider_access_denied',403);fail();}
 const value=result?.data;
 if(!exact(value,['schema','originals'])||value.schema!=='custodial.native-schedule-observation-originals.v1'
  ||!Array.isArray(value.originals)||value.originals.length>16||Array.from({length:value.originals.length},(_,i)=>i).some(i=>!Object.hasOwn(value.originals,i)))fail();
 const originals=new Map();
 for(const o of value.originals){
  if(!exact(o,NATIVE_SCHEDULE_OBSERVATION_ORIGINAL_FIELDS)||Object.values(o).some(x=>typeof x!=='string'||!x||/[\u0000-\u001f\u007f-\u009f]/u.test(x))
   ||!jobs.includes(o.job_id)||originals.has(o.job_id)||o.credential_id!==credentialId
   ||!['job_id','generation_id','source_reservation_id','credential_id','employee_id'].every(k=>UUID.test(o[k]))
   ||!['record_id','principal_digest','token_digest','content_sha256'].every(k=>SHA.test(o[k]))
   ||!/^KIOSK_(?:0[2-9]|10)$/.test(o.device_id)||! /^[1-9][0-9]{0,15}$/.test(o.assignment_epoch)
   ||BigInt(o.assignment_epoch)>9007199254740991n
   ||createHash('sha256').update(o.generation_id+'\n'+o.source_reservation_id+'\n'+o.notification_key).digest('hex')!==o.record_id)fail();
  let scheduleKey;try{scheduleKey=isNativeScheduleEvent({notification_key:o.notification_key,receipt_employee_id:o.employee_id});}catch{fail();}
  if(!scheduleKey)fail();
  originals.set(o.job_id,Object.freeze({...o}));
 }
 if(jobs.some(job=>!originals.has(job)))fail();
 return originals;
}
