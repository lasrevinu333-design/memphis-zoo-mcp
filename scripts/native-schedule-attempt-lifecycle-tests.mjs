import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';
import {validateNativeScheduleDispatch,prepareNativeScheduleAttempt,readNativeScheduleAttempt,recordNativeScheduleOutcome} from '../src/native-schedule-attempt-lifecycle.js';
const f=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url))),id=n=>`ab000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const p=f.payload,lease=id(1),a={attempt_id:id(2),outcome_operation_id:id(3),attempt_reserved_at:'2026-10-08T14:47:00.999999Z',
 binding:{receipt_job_id:p.receipt_job_id,lease_token:lease,registration_id:f.expected.registration_id,generation_id:p.generation_id,
  reservation_at:p.reservation_at,content_sha256:p.content_sha256,token_digest:p.token_digest,principal_digest:p.principal_digest,
  receipt_credential_id:p.receipt_credential_id,receipt_assignment_epoch:p.receipt_assignment_epoch,receipt_employee_id:p.receipt_employee_id,
  receipt_device_id:p.receipt_device_id,source_reservation_id:p.source_reservation_id},payload:p,wire:canonicalNativeLocation(p),ttl_seconds:779};
const first={schema:'custodial.native-schedule-dispatch.v1',dispatch_authorized:true,delivery_admitted:false,replayed:false,reason:null,attempt:a};
const ctx={jobId:p.receipt_job_id,leaseToken:lease,sourceReservationId:p.source_reservation_id,expected:f.expected,sourceCandidate:f.sourceCandidate};
const status=(e=null)=>({schema:'custodial.native-schedule-dispatch-status.v1',attempted:true,dispatch_authorized:false,delivery_admitted:false,
 attempt:{attempt_id:a.attempt_id,outcome_operation_id:a.outcome_operation_id,attempt_reserved_at:a.attempt_reserved_at,binding:a.binding,
 provider_outcome:e?.outcome??'prepared',evidence:e,server_received_at:e?'2026-10-08T15:01:00.000000Z':null}});
export async function runNativeScheduleAttemptLifecycleTests(){
 let checks=0;const eq=(n,x,y)=>{assert.deepEqual(x,y,n);checks++;},bad=(n,fn)=>{assert.throws(fn,undefined,n);checks++;},reject=async(n,fn)=>{await assert.rejects(fn,undefined,n);checks++;};
 eq('closed original permit',validateNativeScheduleDispatch(first,ctx),first);
 for(const k of Object.keys(first)){const v=structuredClone(first);delete v[k];bad('permit missing '+k,()=>validateNativeScheduleDispatch(v,ctx));}
 for(const k of Object.keys(a)){const v=structuredClone(first);delete v.attempt[k];bad('attempt missing '+k,()=>validateNativeScheduleDispatch(v,ctx));}
 for(const k of Object.keys(a.binding)){const v=structuredClone(first);delete v.attempt.binding[k];bad('binding missing '+k,()=>validateNativeScheduleDispatch(v,ctx));}
 for(const patch of [{ttl_seconds:780},{ttl_seconds:0},{attempt_reserved_at:'2026-10-08T15:00:00.000000Z'},
  {attempt_reserved_at:'2026-02-30T14:46:00.000000Z'},{attempt_reserved_at:'2026-10-08T14:45:00.000000Z'},
  {attempt_id:a.outcome_operation_id},{binding:{...a.binding,registration_id:id(99)}},{wire:a.wire+' '},{extra:true}]){
  bad('bad attempt '+Object.keys(patch)[0],()=>validateNativeScheduleDispatch({...first,attempt:{...a,...patch}},ctx));
 }
 for(const patch of [{replayed:true},{delivery_admitted:true},{reason:'READY'},{extra:true}])bad('bad authority '+Object.keys(patch)[0],()=>validateNativeScheduleDispatch({...first,...patch},ctx));
 bad('crossed source',()=>validateNativeScheduleDispatch(first,{...ctx,sourceReservationId:id(99)}));
 let calls=[];const db={rpc:async(name,args)=>{calls.push(name);eq('exact attempt args',args,{p_job:ctx.jobId,p_lease:lease,p_source:ctx.sourceReservationId,p_expected:f.expected});return{data:first};}};
 eq('adapter exact permit',await prepareNativeScheduleAttempt({...ctx,db}),first);eq('only prepare RPC',calls,['custodial_native_schedule_dispatch_prepare']);
 for(const db of [{rpc:async()=>{throw Error('synthetic loss');}},{rpc:async()=>({error:{code:'XX000'}})}]){
  const v=await prepareNativeScheduleAttempt({...ctx,db});eq('ambiguous attempt no send right',[v.status,v.dispatch_authorized,v.delivery_admitted],['ATTEMPT_RECONCILIATION_PENDING',false,false]);
 }
 for(const [replayed,reason] of [[true,'ORIGINAL_ATTEMPT_RETAINED'],[false,'SOURCE_OR_JOB_SUPERSEDED']]){
  const v={...first,dispatch_authorized:false,replayed,reason,attempt:null};eq('explicit read-only refusal',await prepareNativeScheduleAttempt({...ctx,db:{rpc:async()=>({data:v})}}),v);
 }
 eq('prepared is not accepted',await readNativeScheduleAttempt({jobId:ctx.jobId,db:{rpc:async()=>({data:status()})}}),status());
 for(const outcome of ['provider_accepted','known_nonacceptance','delivery_outcome_unknown']){
  const e={operation_id:a.outcome_operation_id,outcome,provider_message_id:outcome==='provider_accepted'?'projects/synthetic/messages/original':null,error_code:outcome==='provider_accepted'?null:'synthetic_unknown'};
  const s=status(e),receipt={schema:'custodial.native-schedule-outcome-receipt.v1',binding:a.binding,evidence:e,
   server_received_at:s.attempt.server_received_at,replayed:false,dispatch_authorized:false,delivery_admitted:false};
  eq('truthful outcome '+outcome,await readNativeScheduleAttempt({jobId:ctx.jobId,db:{rpc:async()=>({data:s})}}),s);
  eq('exact persisted outcome '+outcome,await recordNativeScheduleOutcome({binding:a.binding,evidence:e,db:{rpc:async()=>({data:receipt})}}),receipt);
  calls=[];const reconciled=await recordNativeScheduleOutcome({binding:a.binding,evidence:e,db:{rpc:async(name)=>{calls.push(name);
   if(name==='custodial_native_schedule_outcome')throw Error('response lost after commit');return{data:s};}}});
  eq('lost outcome response reconciles original',reconciled.status,'ORIGINAL_OUTCOME_RECONCILED');
  eq('no second attempt or send',[reconciled.dispatch_authorized,calls],[false,['custodial_native_schedule_outcome','custodial_native_schedule_dispatch_status']]);
  const pending=await recordNativeScheduleOutcome({binding:a.binding,evidence:e,db:{rpc:async(name)=>name==='custodial_native_schedule_outcome'?{error:{code:'XX000'}}:{data:status()}}});
  eq('missing outcome pending, never accepted',pending.status,'ATTEMPT_RECONCILIATION_PENDING');
  for(const key of Object.keys(e)){const v={...e};delete v[key];await reject('missing evidence '+key,()=>recordNativeScheduleOutcome({binding:a.binding,evidence:v,db:{rpc:async()=>assert.fail('no malformed RPC')}}));}
 }
 for(const patch of [{delivery_admitted:true},{dispatch_authorized:true},{attempt:{...status().attempt,extra:true}},
  {attempt:{...status().attempt,binding:{...a.binding,receipt_job_id:id(99)}}},
  {attempt:{...status().attempt,provider_outcome:'delivered'}},{attempted:false}])await reject('bad status '+Object.keys(patch)[0],()=>readNativeScheduleAttempt({jobId:ctx.jobId,db:{rpc:async()=>({data:{...status(),...patch}})}}));
 const source=readFileSync(new URL('../src/employee-notifications.js',import.meta.url),'utf8');eq('real worker still has independent unqualified hold',source.includes('holdUnqualifiedNativeScheduleJob(job);'),true);
 return{status:'PASS',checks,actual_SQL:false,provider_dispatch:false,native_qualified:false,phone:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await runNativeScheduleAttemptLifecycleTests()));
