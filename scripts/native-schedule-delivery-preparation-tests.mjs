import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {validateNativeScheduleSourceReservation,buildNativeScheduleContentCandidate,prepareNativeScheduleContent} from '../src/native-schedule-delivery-preparation.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-source-original.json',import.meta.url)));
const clone=x=>structuredClone(x),uuid='11111111-1111-4111-8111-111111111111';
const context=f=>({sourceKey:f.reservation.window.assignment_occurrence_id,employeeId:f.reservation.window.employee_id,
 generationId:f.reservation.window.generation_id,expectedSourceSha256:f.reservation.window.server_source_sha256,operationId:f.reservation.operation_id});
const current=f=>({schema:'custodial.native-schedule-source-status.v1',status:'ORIGINAL_SOURCE_RETAINED',source_current:true,
 current_source_status:'CURRENT_WINDOW_SOURCE_ONLY',dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null,reservation:clone(f.reservation)});
const content=(f,status=current(f))=>({schema:'custodial.native-schedule-content-source.v1',status:status.source_current===true?'CONTENT_CURRENT_SOURCE_ONLY':'CONTENT_SOURCE_UNAVAILABLE',
 dispatch_authorized:false,delivery_admitted:false,source_status:status,candidate:status.source_current===true?buildNativeScheduleContentCandidate(f,context(f)):null});
const rehash=f=>{f.reservation.window_sha256=postgresJsonbContentDigest(f.reservation.window);return f;};
export async function runNativeScheduleDeliveryPreparationTests(){
 let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const first=clone(fixture.first),expected=context(first),before=JSON.stringify(first);
 const accepted=validateNativeScheduleSourceReservation(first,expected),candidate=buildNativeScheduleContentCandidate(first,expected);
 eq(JSON.stringify(first),before);eq(Object.isFrozen(accepted.reservation.window.recipient),true);eq(Object.isFrozen(candidate),true);
 eq(candidate.body,'Synthetic provider 1, your scheduled responsibilities have changed at 9:45 AM. Please see your Schedule page for your updated assignments.');
 eq(candidate.kind,'employee_schedule_ownership');eq(candidate.notification_type,'schedule_ownership');eq(candidate.channel_id,'employee-schedule-ownership');
 eq(candidate.route,'employee-schedule.html?hub=employee');eq(candidate.notification_key,first.reservation.window.logical_key);
 eq(candidate.source_reservation_id,first.reservation.reservation_id);eq(candidate.source_operation_id,expected.operationId);
 eq(candidate.source_valid_from,first.reservation.window.valid_from);eq(candidate.source_valid_until,first.reservation.window.valid_until);
 eq(candidate.server_source_sha256,expected.expectedSourceSha256);eq(candidate.employee_id,expected.employeeId);
 for(const field of ['token','token_digest','principal_digest','valid_until','reservation_at','content_sha256','receipt_job_id','dispatch_authorized'])eq(Object.hasOwn(candidate,field),false,field+'not manufactured');
 const replay=clone(fixture.replay),alias={...expected,operationId:uuid};
 eq(buildNativeScheduleContentCandidate(replay,alias),candidate);eq(validateNativeScheduleSourceReservation(replay,alias).reservation.operation_id,expected.operationId);
 const validCases=[];
 for(const name of ['María 😀','A name with “quotes”','名前']){const f=clone(first);f.reservation.window.employee_name=name;rehash(f);const c=buildNativeScheduleContentCandidate(f,context(f));eq(c.body.startsWith(name+', '),true);validCases.push(c);}
 // Explicitly modeled calendar variants, NOT new database/calendar/clock proof.
 for(const [date,from,until] of [['2027-03-14','2027-03-14T14:45:00.000000Z','2027-03-14T15:00:00.000000Z'],['2027-11-07','2027-11-07T15:45:00.000000Z','2027-11-07T16:00:00.000000Z']]){
  const f=clone(first),w=f.reservation.window;w.service_date=date;w.logical_key=`schedule-ownership:${date}:${w.employee_id}:09:45`;
  w.valid_from=from;w.valid_until=until;w.server_now=from.replace(':45:00.000000Z',':46:00.000000Z');f.reservation.reserved_at=w.server_now;rehash(f);
  eq(buildNativeScheduleContentCandidate(f,context(f)).service_date,date);
 }
 for(const mutate of [f=>f.dispatch_authorized=true,f=>f.delivery_admitted=true,f=>f.clock_effect_authority={},f=>f.retention_authority={},
  f=>f.extra='caller override',f=>f.replayed=true,f=>f.reserved='true',f=>f.schema='custodial.native-provider-payload.v1',
  f=>f.reservation.operation_id=uuid,f=>f.reservation.window.extra='unknown',
  f=>f.reservation.window.employee_id=uuid,f=>f.reservation.window.generation_id=uuid,f=>f.reservation.window.assignment_occurrence_id=uuid,
  f=>f.reservation.window.server_source_sha256='f'.repeat(64),f=>f.reservation.window.source_revision='0',f=>f.reservation.window.source_revision='9007199254740992',
  f=>f.reservation.window.recipient.assignment_epoch='1',f=>f.reservation.window.recipient.employee_id=uuid,
  f=>f.reservation.window.recipient.device_identifier='KIOSK_01',f=>f.reservation.window.recipient.extra='unknown',
  f=>f.reservation.window.employee_name='',f=>f.reservation.window.employee_name='x'.repeat(181),f=>f.reservation.window.employee_name='bad\nname',
  f=>f.reservation.window.employee_name='bad\ud800name',f=>f.reservation.window.valid_from='2026-02-30T14:45:00.000000Z',
  f=>f.reservation.window.valid_until=f.reservation.window.server_now,f=>f.reservation.window.server_now=f.reservation.window.valid_until,
  f=>f.reservation.window.valid_from=f.reservation.window.valid_from.replace(':45:',':44:'),f=>f.reservation.reserved_at=f.reservation.window.valid_from,
  f=>f.reservation.window.before_units=clone(f.reservation.window.after_units),f=>f.reservation.window.after_units.reverse(),
  f=>f.reservation.window.after_units.push(f.reservation.window.after_units[0]),f=>f.reservation.window.after_units=['LOCATION:not-a-stable-id'],
  f=>f.reservation.window.before_units=['DUTY:routine_clean:'+uuid],f=>f.reservation.window.timezone='UTC']){
  const f=clone(first);mutate(f);rehash(f);assert.throws(()=>validateNativeScheduleSourceReservation(f,expected),/native_schedule_delivery_preparation_invalid/);checks++;
 }
 const badHash=clone(first);badHash.reservation.window_sha256='f'.repeat(64);assert.throws(()=>validateNativeScheduleSourceReservation(badHash,expected),/invalid/);checks++;
 const badPrototype=clone(first);badPrototype.reservation.window.recipient=Object.assign(Object.create({unsupported:true}),badPrototype.reservation.window.recipient);
 assert.throws(()=>validateNativeScheduleSourceReservation(badPrototype,expected),/invalid/);checks++;
 for(const mutate of [f=>f.reservation.reservation_id=new String(f.reservation.reservation_id),
  f=>f.reservation.window.recipient.principal_digest=new String(f.reservation.window.recipient.principal_digest),
  f=>f.reservation.window.after_units.extra='unsupported',f=>f.reservation.window.after_units[Symbol('extra')]='unsupported',
  f=>delete f.reservation.window.after_units[0],f=>Object.defineProperty(f.reservation.window,'employee_name',{get:()=>{throw Error('PRIVATE GETTER');},enumerable:true}),
  f=>Object.defineProperty(f,'hidden',{value:'unsupported',enumerable:false}),f=>f[Symbol('hidden')]='unsupported']){
  const f=clone(first);mutate(f);assert.throws(()=>validateNativeScheduleSourceReservation(f,expected),/native_schedule_delivery_preparation_invalid/);checks++;
 }
 assert.throws(()=>validateNativeScheduleSourceReservation(first,{...expected,expectedSourceSha256:new String(expected.expectedSourceSha256)}),/invalid/);checks++;
 for(const reason of ['TARGET_STALE','SOURCE_STALE','WINDOW_NOT_STARTED','SOURCE_WINDOW_EXPIRED','NO_OWNERSHIP_CHANGE','SOURCE_CHANGED','ORIGINAL_SOURCE_CONFLICT']){
  const response={schema:first.schema,status:reason,reserved:false,replayed:false,dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null,reservation:null};
  eq(validateNativeScheduleSourceReservation(response,expected).reserved,false);
  let calls=0;const p=await prepareNativeScheduleContent({db:{rpc:async()=>{calls++;return{data:response};}},...expected});eq(p.candidate,null);eq(calls,1);eq(p.reason,reason);
 }
 const calls=[],result=await prepareNativeScheduleContent({db:{rpc:async(name,args)=>{calls.push({name,args});return{data:calls.length===1?clone(first):content(first)};}},...expected});
 eq(calls.map(x=>x.name),['custodial_native_schedule_source_reserve','custodial_native_schedule_content_source']);
 eq(calls[0].args.p_expected_source_sha256,expected.expectedSourceSha256);eq(calls[1].args.p_operation_id,expected.operationId);
 eq(result.candidate,candidate);eq(result.status,'CONTENT_PREPARED_NATIVE_UNQUALIFIED');
 for(const field of ['dispatch_authorized','delivery_admitted'])eq(result[field],false);for(const field of ['clock_effect_authority','retention_authority'])eq(result[field],null);
 for(const fault of ['reserve-throw','reserve-error','status-throw','status-error','expired','notfound']){
  let n=0;const p=await prepareNativeScheduleContent({db:{rpc:async()=>{
   if(++n===1){if(fault==='reserve-throw')throw Error('PRIVATE TRANSPORT');if(fault==='reserve-error')return{error:{message:'PRIVATE TRANSPORT'}};return{data:clone(first)};}
   if(fault==='status-throw')throw Error('PRIVATE TRANSPORT');if(fault==='status-error')return{error:{message:'PRIVATE TRANSPORT'}};
   if(fault==='expired')return{data:content(first,clone(fixture.expired))};
   return{data:content(first,{schema:'custodial.native-schedule-source-status.v1',status:'ORIGINAL_NOT_FOUND',source_current:false,dispatch_authorized:false,delivery_admitted:false,reservation:null})};
  }},...expected});eq(p.candidate,null);eq(p.dispatch_authorized,false);eq(JSON.stringify(p).includes('PRIVATE'),false);
 }
 for(const mutate of [s=>s.dispatch_authorized=true,s=>s.source_current='true',s=>s.current_source_status='WINDOW_NOT_STARTED',s=>s.extra='unknown',
  s=>s.reservation.window.employee_name='a different name',s=>s.reservation.operation_id=uuid]){
  let n=0;const status=current(first);mutate(status);status.reservation.window_sha256=postgresJsonbContentDigest(status.reservation.window);
  await assert.rejects(()=>prepareNativeScheduleContent({db:{rpc:async()=>({data:++n===1?clone(first):content(first,status)})},...expected}),/invalid/);checks++;
 }
 for(const mutate of [x=>x.candidate.body='unapproved replacement',x=>x.candidate.kind='employee_message',x=>x.candidate.extra='override',
  x=>x.dispatch_authorized=true,x=>x.delivery_admitted=true,x=>x.status='PROVIDER_ACCEPTED',x=>x.extra='override']){
  let n=0;const response=clone(content(first));mutate(response);
  await assert.rejects(()=>prepareNativeScheduleContent({db:{rpc:async()=>({data:++n===1?clone(first):response})},...expected}),/invalid/);checks++;
 }
 let n=0,mutable=clone(first);const raced=await prepareNativeScheduleContent({db:{rpc:async()=>{
  if(++n===1)return{data:mutable};mutable.reservation.window.employee_name='late mutation';return{data:content(first)};
 }},...expected});eq(raced.candidate,candidate,'source snapshot retained before second await');
 const aliasCalls=[];await prepareNativeScheduleContent({db:{rpc:async(name,args)=>{aliasCalls.push(args);return{data:aliasCalls.length===1?clone(replay):content(first)};}},...alias});
 eq(aliasCalls[1].p_operation_id,expected.operationId,'status uses actual original operation, not retry alias');
 return {status:'PASS',checks,source_fixture:'Retained actual238SQL first/replay/expired bytes; modeled fresh RPC currentness/calendar variants',
  new_sql_executed:false,provider_dispatch:false,clock_admitted:false,retention_admitted:false,native_wire_admitted:false,phone:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleDeliveryPreparationTests()));
