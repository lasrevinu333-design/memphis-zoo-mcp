import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';
import {validateNativeSchedulePayload,nativeScheduleRecordId,NATIVE_SCHEDULE_PAYLOAD_KEYS} from '../src/native-schedule-payload.js';
const f=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url))),clone=x=>structuredClone(x);
const options={jobId:f.payload.receipt_job_id,expected:f.expected,sourceCandidate:f.sourceCandidate};
const rehash=p=>{p.content_sha256=createHash('sha256').update(canonicalNativeLocation(p,{excludeHash:true})).digest('hex');return p;};
export function runNativeSchedulePayloadTests(){
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 eq(f.actual_SQL_receipt,false);eq(f.native_qualified,false);eq(NATIVE_SCHEDULE_PAYLOAD_KEYS.length,32);
 const before=JSON.stringify(f),p=validateNativeSchedulePayload(f.payload,options);eq(p,f.payload);eq(Object.isFrozen(p),true);eq(JSON.stringify(f),before);
 eq(canonicalNativeLocation(p),f.wire);eq(nativeScheduleRecordId(p),f.record_id);eq(p.kind,'employee_schedule_ownership');eq(p.channel_id,'employee-schedule-ownership');
 for(const key of NATIVE_SCHEDULE_PAYLOAD_KEYS){for(const change of [x=>delete x[key],x=>x[key]=true]){
  const bad=clone(f.payload);change(bad);assert.throws(()=>validateNativeSchedulePayload(bad,options),/invalid/);checks++;
 }const bad=clone(f.payload);bad[key]+='x';assert.throws(()=>validateNativeSchedulePayload(bad,options),/invalid/);checks++;}
 for(const [key,value] of [['kind','employee_message'],['schema','custodial.native-message-payload.v1'],['channel_id','employee-messages'],
  ['notification_type','lunch_coverage'],['route','https://external.invalid/'],['boundary_local','09:46'],['source_revision','0'],['source_revision','9007199254740992'],
  ['reservation_at',p.source_valid_from.replace(':45:',':44:')],['valid_until',p.source_valid_until.replace(':00:',':01:')],
  ['valid_until',p.reservation_at],['source_reservation_id','not-a-stable-id'],['body','bad\ncontent']]){
  const bad=clone(f.payload);bad[key]=value;rehash(bad);assert.throws(()=>validateNativeSchedulePayload(bad,options),/invalid/);checks++;
 }
 for(const key of Object.keys(options.expected)){const bad=clone(options.expected);bad[key]=key==='assignment_epoch'?'2':key==='device_id'?'KIOSK_10':key.endsWith('digest')?'f'.repeat(64):'33333333-3333-4333-8333-333333333333';
  if(key==='registration_id'){eq(validateNativeSchedulePayload(p,{...options,expected:bad}),p);continue;} // Receipt API binds this separately; raw wire carries no registration ID.
  assert.throws(()=>validateNativeSchedulePayload(p,{...options,expected:bad}),/invalid/);checks++;
 }
 const foreign=clone(f.sourceCandidate);foreign.body='different source content';assert.throws(()=>validateNativeSchedulePayload(p,{...options,sourceCandidate:foreign}),/invalid/);checks++;
 const extra=clone(f.payload);extra.test_delivery='true';rehash(extra);assert.throws(()=>validateNativeSchedulePayload(extra,options),/invalid/);checks++;
 const differentJob=clone(p);differentJob.receipt_job_id='44444444-4444-4444-8444-444444444444';rehash(differentJob);
 eq(nativeScheduleRecordId(differentJob),nativeScheduleRecordId(p));eq(differentJob.content_sha256===p.content_sha256,false);
 return{status:'PASS',checks,wire_schema:p.schema,source_content:'Retained actualSQL candidate',receipt:'Modeled synthetic future envelope; notactualSQL/provider receipt',provider_dispatch:false,native_qualified:false,phone:false};
}
if(process.argv[1]?.endsWith('native-schedule-payload-tests.mjs'))console.log(JSON.stringify(runNativeSchedulePayloadTests()));
