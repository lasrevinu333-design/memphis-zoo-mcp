import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {deliverNativeMessageJob,prepareNativeMessageDataSender} from '../src/native-message-dispatch.js';
import {buildNativeAlertCandidate} from '../src/native-alert-two-stage.js';
import {canonicalNativeAlert} from '../src/native-alert-reservation.js';
import {messageFixture,id,sha} from './fixtures/native-message-dispatch-fixture.mjs';

import {qualifiedAlertDispatcher as dispatcher} from './fixtures/qualified-alert-dispatcher.mjs';

const run=f=>deliverNativeMessageJob(f);
const names=f=>f.calls.map(x=>x.name);
const expectError=async(f,code)=>assert.rejects(()=>run(f),e=>e.code===code);
const makePermit=f=>f.finalize(buildNativeAlertCandidate(f.prepared,{}));
test('actual employee dispatcher reaches qualified MESSAGE, source-bound data-only provider, append-only outcome',async()=>{
 const f=messageFixture(),before=structuredClone(f.job),runtime=await dispatcher(f);
 const result=await runtime.deliverClaimedJob(f.job);
 assert.equal(result.provider_message_id,'projects/synthetic-zoo/messages/original');assert.deepEqual(f.job,before);
 assert.deepEqual(names(f),['custodial_native_alert_dispatch_status','OAUTH_SYNTHETIC','custodial_native_alert_target',
  'custodial_native_alert_prepare','custodial_native_alert_finalize','FCM_SYNTHETIC','custodial_native_alert_record_outcome']);
 const request=f.requests[0];assert.equal(request.init.redirect,'error');assert.equal(request.init.signal.aborted,false);
 assert.deepEqual(Object.keys(request.body),['message']);assert.deepEqual(Object.keys(request.body.message).sort(),['android','data','token']);
 assert.deepEqual(request.body.message.data,f.permit.reservation.payload);
 assert.equal(request.body.message.data.body,before.payload_json.body);
 assert.deepEqual(request.body.message.android,{priority:'high',ttl:'60s',restricted_package_name:'org.memphiszoo.custodial'});
 assert.equal(f.ledger.provider_outcome,'provider_accepted');
});
test('actual dispatcher preserves separate lunch and location lanes',async()=>{
 const f=messageFixture(),r=await dispatcher(f);
 for(const kind of ['lunch','location']){
  const j=structuredClone(f.job);j.job_key='other';j.payload_json.data_json={kind:kind==='lunch'?'employee_lunch_coverage':'employee_location_status'};
  assert.equal((await r.deliverClaimedJob(j)).unchanged,kind);
 }assert.equal(f.calls.length,0);
});
test('explicit boolean manager test does not enter native production MESSAGE owner',async()=>{
 const f=messageFixture();f.job.payload_json.data_json.test_delivery=true;
 f.db.rpc=async name=>{f.calls.push({name});throw Error('STOP_BEFORE_PROVIDER');};
 const r=await dispatcher(f);await assert.rejects(()=>r.deliverClaimedJob(f.job));
 assert.equal(f.calls[0].name,'mz_get_employee_native_push_delivery_receipt');assert.equal(f.requests.length,0);
});
for(const marker of [false,'true',1,0,null,{},[]])test('non-boolean or false manager marker cannot bypass '+JSON.stringify(marker),async()=>{
 const f=messageFixture();f.job.payload_json.data_json.test_delivery=marker;
 const r=await dispatcher(f);await assert.rejects(()=>r.deliverClaimedJob(f.job),/contract_invalid/);assert.equal(f.calls.length,0);
});
test('caller mutation during OAuth cannot switch source, recipient or spoken content',async()=>{
 const f=messageFixture({oauth(job){job.source_id=id(77);job.payload_json.body='Caller replacement';job.payload_json.employee_id=id(78);}});
 await run(f);const data=f.requests[0].body.message.data;
 assert.equal(data.message_id,id(10));assert.equal(data.receipt_employee_id,id(3));assert.equal(data.body,'Original synthetic message.');
});
test('no OAuth or provider invocation for previously accepted exact receipt',async()=>{
 const f=messageFixture();const prior=f.reserved(makePermit(f),'provider_accepted','projects/synthetic-zoo/messages/previous');
 const g=messageFixture({prior});assert.equal((await run(g)).replayed,true);
 assert.deepEqual(names(g),['custodial_native_alert_dispatch_status']);
});
for(const outcome of ['prepared','known_nonacceptance','delivery_outcome_unknown'])test('reserved '+outcome+' never authorizes resend',async()=>{
 const f=messageFixture(),prior=f.reserved(makePermit(f),outcome,null,outcome==='prepared'?null:'synthetic_failure');
 const g=messageFixture({prior});await assert.rejects(()=>run(g),e=>e.terminal===true&&e.deferFinish===false);
 assert.deepEqual(names(g),['custodial_native_alert_dispatch_status']);
});
test('status loss preserves pending original rather than finishing/retrying provider',async()=>{
 const f=messageFixture({statusError:true});await assert.rejects(()=>run(f),e=>e.code==='native_message_status_pending'&&e.deferFinish===true);
 assert.equal(f.requests.length,0);
});
for(const field of ['token','credential','generation','extra'])test('invalid current recipient '+field+' fails closed before preparation',async()=>{
 const f=messageFixture({targetTransform(v){if(field==='token')v.token+='crossed';if(field==='credential')v.expected.credential_id=id(99);
  if(field==='generation')v.expected.generation_id='bad';if(field==='extra')v.extra=true;return v;}});
 await assert.rejects(()=>run(f));assert.equal(names(f).includes('custodial_native_alert_prepare'),false);assert.equal(f.requests.length,0);
});
test('actual target reassignment is a terminal no-send disposition',async()=>{
 const f=messageFixture({targetTransform:()=>({current:false,reason:'native_alert_recipient_superseded'})});
 await assert.rejects(()=>run(f),e=>e.terminal===true);assert.equal(f.requests.length,0);
});
for(const reason of ['message_deleted','membership_removed','message_acknowledged','message_source_changed'])test('source refusal '+reason+' cannot dispatch',async()=>{
 const f=messageFixture({prepareTransform:()=>({current:false,reason})});await expectError(f,'native_message_qualification_pending');
 assert.equal(f.requests.length,0);assert.equal(names(f).includes('custodial_native_alert_finalize'),false);
});
for(const change of ['hash','route','ttl','replayed','extra','source'])test('invalid final permit '+change+' is no-send',async()=>{
 const f=messageFixture({permitTransform(p){
  if(change==='hash')p.reservation.payload.content_sha256='a'.repeat(64);
  if(change==='route')p.reservation.payload.route='https://external.invalid';
  if(change==='ttl')p.ttl_seconds++;
  if(change==='replayed')p.reservation.replayed=true;
  if(change==='extra')p.extra=true;
  if(change==='source'){
   p.reservation.payload.source_revision=sha('changed-source');
   p.reservation.payload.content_sha256=sha(canonicalNativeAlert(p.reservation.payload,{excludeHash:true}));
   p.reservation.wire=canonicalNativeAlert(p.reservation.payload);
  }return p;
 }});await assert.rejects(()=>run(f));assert.equal(f.requests.length,0);
});
test('lost finalization ACK resolves prepared ledger without resending',async()=>{
 const f=messageFixture({finalizeError:true});await expectError(f,'native_message_outcome_unknown_no_resend');assert.equal(f.requests.length,0);
 assert.equal(names(f).filter(n=>n==='custodial_native_alert_dispatch_status').length,2);
});
for(const option of ['recordError','recordThrow'])test('lost outcome ACK '+option+' reads original durable evidence without a second provider call',async()=>{
 const f=messageFixture({[option]:true});const result=await run(f);
 assert.equal(result.replayed,true);assert.equal(f.requests.length,1);assert.equal(names(f).at(-1),'custodial_native_alert_dispatch_status');
});
test('conflicting outcome readback stays unresolved and never resends',async()=>{
 const f=messageFixture({recordError:true,recordTransform:v=>({...v,attempt_id:id(80)})});
 await expectError(f,'native_message_outcome_reconciliation_pending');assert.equal(f.requests.length,1);
});
test('delivered predecessor receipt is retained, not routed back into generic sender',async()=>{
 const f=messageFixture({prepareError:true,legacy:{current:true,already_recorded:true,provider_message_id:'projects/synthetic-zoo/messages/predecessor'}});
 assert.equal((await run(f)).legacy_original,true);assert.equal(f.requests.length,0);
 assert.deepEqual(names(f).slice(-2),['custodial_native_alert_dispatch_status','mz_get_employee_native_push_delivery_receipt']);
});
test('ambiguous predecessor cannot create new permission or release-for-resend',async()=>{
 const f=messageFixture({prepareError:true,legacy:{current:true,already_recorded:false,delivery_outcome_unknown:true}});
 await expectError(f,'native_message_qualification_pending');assert.equal(f.requests.length,0);
 assert.equal(names(f).some(n=>n.includes('release')),false);
});
for(const status of [400,401,403,404,429,408,500,503])test('provider HTTP '+status+' is retained with explicit certainty',async()=>{
 const f=messageFixture({fetchImpl:async()=>new Response('',{status})});await assert.rejects(()=>run(f),e=>e.terminal===true);
 assert.equal(f.requests.length,1);assert.equal(f.ledger.provider_outcome,status<500&&status!==408?'known_nonacceptance':'delivery_outcome_unknown');
});
for(const [label,fetchImpl] of [
 ['throw',async()=>{throw Error('synthetic socket loss');}],
 ['malformed',async()=>new Response('not JSON')],
 ['oversized',async()=>new Response('x'.repeat(16385))],
 ['wrong project',async()=>new Response(JSON.stringify({name:'projects/other-zoo/messages/other'}))],
 ['unknown fields',async()=>new Response(JSON.stringify({name:'projects/synthetic-zoo/messages/original',other:true}))],
])test('ambiguous provider '+label+' does not become accepted or resend',async()=>{
 const f=messageFixture({fetchImpl});await expectError(f,'native_message_outcome_unknown_no_resend');
 assert.equal(f.ledger.provider_outcome,'delivery_outcome_unknown');assert.equal(f.requests.length,1);
});
test('one-use sender revalidates permit/token and cannot be reused after refusal',async()=>{
 const f=messageFixture(),permit=makePermit(f);let calls=0;
 const sender=prepareNativeMessageDataSender({projectId:'synthetic-zoo',accessToken:'synthetic',fetchImpl:async()=>{calls++;throw Error('not reached');}});
 const input={permit,jobId:f.job.job_id,leaseToken:f.job.lease_token,expected:f.expected,token:'crossed'};
 await assert.rejects(()=>sender(input));input.token=f.token;
 await assert.rejects(()=>sender(input),e=>e.code==='native_message_sender_already_consumed');assert.equal(calls,0);
});
test('owning manager runtime prepares OAuth before constructing private strict sender',async()=>{
 const source=await readFile(new URL('../src/manager-notifications.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function prepareNativeMessageSender() {'),end=source.indexOf('\n  }',start)+4;
 assert.ok(start>0&&end>start);const method=source.slice(start,end),order=[];
 const prepare=runInNewContext(method+'\nprepareNativeMessageSender;',{
  PUSH_SCOPE:'synthetic-scope',account:{project_id:'synthetic-zoo'},accessToken:async scope=>{order.push(scope);return 'synthetic-token';},
  prepareNativeMessageDataSender:args=>{order.push('sender');assert.equal(args.accessToken,'synthetic-token');return()=>{};}});
 assert.equal(typeof await prepare(),'function');assert.deepEqual(order,['synthetic-scope','sender']);
 const tail=source.slice(end,source.indexOf('\n}',end));
 const owned=runInNewContext('(function(){'+method+tail+'})()',{
  account:{project_id:'synthetic-zoo'},getClientConfig(){},send(){},sweep(){},
  prepareNativeLocationSender(){},prepareNativeLunchSender(){},
  accessToken:async()=> 'synthetic-token',PUSH_SCOPE:'synthetic-scope',prepareNativeMessageDataSender:()=>()=>{}});
 assert.equal(owned.configured,true);assert.equal(typeof owned.prepareNativeMessageSender,'function');
 assert.equal(typeof await owned.prepareNativeMessageSender(),'function');
});
test('OAuth failure cannot enter source preparation or provider boundary',async()=>{
 const f=messageFixture({oauth(){throw Error('synthetic authorization service unavailable');}});
 await expectError(f,'native_message_sender_preparation_pending');
 assert.deepEqual(names(f),['custodial_native_alert_dispatch_status','OAUTH_SYNTHETIC']);
});
