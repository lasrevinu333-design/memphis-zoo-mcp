import assert from 'node:assert/strict';
import {readNativeTargetSource,validateNativeTargetSourceProjection} from '../src/native-target-source.js';

const sourceKey='34000000-0000-4000-8000-000000000001';
const employeeId='34000000-0000-4000-8000-000000000002';
const generationId='34000000-0000-4000-8000-000000000003';
const deviceId='34000000-0000-4000-8000-000000000004';
const credentialId='34000000-0000-4000-8000-000000000005';
const msgUser='34000000-0000-4000-8000-000000000006';
const sourceId='34000000-0000-4000-8000-000000000007';
const occasion='34000000-0000-4000-8000-000000000008';
const at='2026-10-02T12:00:00.123456+00:00';
const until='2026-10-02T13:00:00.123456+00:00';
const recipient={employee_id:employeeId,device_id:deviceId,device_identifier:'KIOSK_08',
 credential_id:credentialId,assignment_epoch:7,generation_id:generationId,
 principal_digest:'a'.repeat(64),token_digest:'b'.repeat(64)};
const context=kind=>({kind,sourceKey,employeeId,generationId});
const row=(kind,changes={})=>({schema:'custodial.native-target-source.v1',kind,
 source_key:sourceKey,status:kind==='LUNCH'?'CURRENT_SOURCE_ONLY':'SOURCE_ONLY_POLICY_MISSING',
 delivery_admitted:false,recipient:kind==='MESSAGE'?{...recipient,msg_user_id:msgUser}:recipient,
 source:{source_id:sourceId,source_revision:'42',source_digest:'c'.repeat(64),
  delivery_occurrence_id:kind==='SCHEDULE'?null:occasion,
  assignment_occurrence_id:kind==='SCHEDULE'?sourceKey:undefined,
  notification_key:kind==='LUNCH'?'d'.repeat(64):undefined,
  event:kind==='LUNCH'?'start':undefined,
  valid_from:kind==='SCHEDULE'?null:at,valid_until:kind==='LUNCH'?until:null},...changes});
let checks=0;
const pass=(name,condition)=>{assert.ok(condition,name);checks++;console.log('PASS',name)};
for(const kind of ['MESSAGE','SCHEDULE','LUNCH']){
 const value=row(kind),args=context(kind),calls=[];
 const result=await readNativeTargetSource({runRpc:async(name,input)=>{calls.push({name,input});return {data:value}},...args});
 pass(`${kind} exact source returned`,result===value);
 pass(`${kind} exact private RPC args`,calls.length===1&&calls[0].name==='custodial_native_target_source'
  &&JSON.stringify(calls[0].input)===JSON.stringify({p_kind:kind,p_source_key:sourceKey,p_employee_id:employeeId,p_generation_id:generationId}));
 pass(`${kind} never admits delivery`,result.delivery_admitted===false);
 pass(`${kind} typed missing deadline remains missing`,kind==='LUNCH'||result.source.valid_until===null);
}
for(const [name,change] of [
 ['generic success',{delivery_admitted:true}],['foreign target',{recipient:{...recipient,employee_id:sourceId}}],
 ['foreign generation',{recipient:{...recipient,generation_id:sourceId}}],
 ['wrong source key',{source_key:sourceId}],['fabricated message expiry',{source:{...row('MESSAGE').source,valid_until:until}}],
 ['missing lunch expiry',{source:{...row('MESSAGE').source,notification_key:'d'.repeat(64),event:'start',valid_until:null}}],
 ['message source missing occurrence',{source:{...row('MESSAGE').source,delivery_occurrence_id:null}}],
 ['bad digest',{recipient:{...recipient,principal_digest:'not-a-digest'}}],
 ['invalid lunch calendar',{source:{...row('LUNCH').source,valid_until:'2026-02-31T13:00:00+00:00'}}],
 ['lunch microsecond reversal',{source:{...row('LUNCH').source,
   valid_from:'2026-10-02T12:00:00.123456+00:00',valid_until:'2026-10-02T12:00:00.123455+00:00'}}],
]){
 const kind=name.includes('lunch')?'LUNCH':'MESSAGE';
 const candidate=row(kind,change);
 assert.throws(()=>validateNativeTargetSourceProjection(candidate,context(kind)),/native_target_source_response_invalid/);
 pass(`${name} rejected`,true);
}
for(const kind of ['MESSAGE','SCHEDULE','LUNCH']){
 const unavailable={schema:'custodial.native-target-source.v1',kind,source_key:sourceKey,
  status:'SOURCE_STALE',delivery_admitted:false};
 pass(`${kind} stale evidence stays non-admitting`,validateNativeTargetSourceProjection(unavailable,context(kind))===unavailable);
}
for(const [name,args] of [['unknown kind',{...context('EVENT')}],['invalid source',{...context('MESSAGE'),sourceKey:'no'}],
 ['missing runner',{...context('LUNCH'),runRpc:null}]]){
 await assert.rejects(readNativeTargetSource({runRpc:async()=>row('MESSAGE'),...args}),/native_target_source_request_invalid/);
 pass(`${name} rejected before SQL`,true);
}
await assert.rejects(readNativeTargetSource({runRpc:async()=>({error:{code:'42501'}}),...context('MESSAGE')}),/native_target_source_unavailable/);
pass('RPC denial is not a source result',true);
console.log('NATIVE_TARGET_SOURCE_CONTRACT_PASS',checks);
