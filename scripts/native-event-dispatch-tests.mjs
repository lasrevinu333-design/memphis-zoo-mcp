import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deliverNativeEventJob,prepareNativeEventDataSender} from '../src/native-event-dispatch.js';
import {buildNativeAlertCandidate} from '../src/native-alert-two-stage.js';
import {canonicalNativeAlert} from '../src/native-alert-reservation.js';
import {eventFixture} from './fixtures/native-event-dispatch-fixture.mjs';
import {id,sha} from './fixtures/native-message-dispatch-fixture.mjs';
import {qualifiedAlertDispatcher} from './fixtures/qualified-alert-dispatcher.mjs';
const run=f=>deliverNativeEventJob(f),names=f=>f.calls.map(x=>x.name);
const permit=f=>f.finalize(buildNativeAlertCandidate(f.prepared,{eventBody:f.eventBody}));
test('actual Event worker produces closed data-only source-bound wire and excludes private notes',async()=>{
 const f=eventFixture(),before=structuredClone(f.job),worker=await qualifiedAlertDispatcher(f);
 const result=await worker.deliverClaimedJob(f.job);assert.equal(result.native_event,true);assert.deepEqual(f.job,before);
 assert.deepEqual(names(f),['custodial_native_alert_dispatch_status','OAUTH_SYNTHETIC','custodial_native_alert_target',
  'custodial_native_alert_prepare','custodial_native_alert_finalize','FCM_SYNTHETIC','custodial_native_alert_record_outcome']);
 const request=f.requests[0],message=request.body.message;
 assert.deepEqual(Object.keys(message).sort(),['android','data','token']);assert.equal(request.init.redirect,'error');
 assert.equal(message.data.schema,'custodial.native-event-payload.v1');assert.equal(message.data.instance_id,before.source_id);
 assert.equal(message.data.event_id,before.payload_json.event_id);assert.equal(message.data.notification_key,before.payload_json.notification_key);
 assert.match(message.data.body,/Synthetic Employee/);assert.match(message.data.body,/Expected attendance is 120/);
 assert.match(message.data.body,/Eight trash boxes requested/);assert.doesNotMatch(message.data.body,/PRIVATE CATERING/);
 assert.match(message.data.body,/10:30 AM CDT/);assert.match(message.data.body,/11:30 AM CDT/);
 assert.deepEqual(message.android,{priority:'high',ttl:'60s',restricted_package_name:'org.memphiszoo.custodial'});
 assert.equal(f.ledger.provider_outcome,'provider_accepted');assert.equal(f.requests.length,1);
});
test('OAuth caller mutation cannot switch Event or its recipient',async()=>{
 const f=eventFixture({oauth(job){job.source_id=id(99);job.payload_json.event_id=id(98);job.payload_json.employee_id=id(97);}});
 await run(f);assert.equal(f.requests[0].body.message.data.instance_id,id(21));assert.equal(f.requests[0].body.message.data.event_id,id(20));
 assert.equal(f.requests[0].body.message.data.receipt_employee_id,f.expected.employee_id);
});
for(const mutate of [j=>j.job_type='employee_native_push',j=>j.source_id=id(90),j=>j.payload_json.event_id='bad',
 j=>j.payload_json.notification_key=null,j=>j.payload_json.notification_kind='test',j=>j.job_key='foreign',
 j=>j.payload_json.test_delivery=true,j=>j.payload_json.test_delivery=false,j=>j.payload_json.assignment_epoch=0])
 test('invalid Event job refuses before authority/network',async()=>{const f=eventFixture();mutate(f.job);await assert.rejects(()=>run(f));assert.equal(f.calls.length,0);});
for(const mutate of [v=>v.kind='MESSAGE',v=>v.token+='wrong',v=>v.expected.employee_id=id(80),
 v=>v.expected.device_uuid=id(81),v=>v.expected.credential_id=id(82),v=>v.expected.assignment_epoch='3',v=>v.extra=true])
 test('crossed Event target never reaches prepare or provider',async()=>{const f=eventFixture({targetTransform:mutateAndReturn(mutate)});await assert.rejects(()=>run(f));assert.equal(f.requests.length,0);assert.equal(names(f).includes('custodial_native_alert_prepare'),false);});
function mutateAndReturn(fn){return value=>{fn(value);return value;};}
for(const field of ['event_id','instance_id','event_revision','notification_kind','receipt_employee_id','receipt_device_id','source_revision','valid_until'])
 test('changed finalized Event '+field+' cannot dispatch',async()=>{
  const f=eventFixture({permitTransform:p=>{const v=p.reservation.payload;v[field]=field.includes('_id')?id(70):field==='source_revision'?'e'.repeat(64):'wrong';
   v.content_sha256=sha(canonicalNativeAlert(v,{excludeHash:true}));p.reservation.wire=canonicalNativeAlert(v);return p;}});
  await assert.rejects(()=>run(f));assert.equal(f.requests.length,0);
 });
test('accepted original Event receipt is read without OAuth or resend',async()=>{
 const seed=eventFixture(),prior=seed.reserved(permit(seed),'provider_accepted','projects/synthetic-zoo/messages/previous');
 const f=eventFixture({prior});assert.equal((await run(f)).replayed,true);assert.deepEqual(names(f),['custodial_native_alert_dispatch_status']);
});
for(const outcome of ['prepared','delivery_outcome_unknown','known_nonacceptance'])
 test('reserved Event '+outcome+' never authorizes resend',async()=>{
  const seed=eventFixture(),prior=seed.reserved(permit(seed),outcome,null,outcome==='prepared'?null:'synthetic_failure');
  const f=eventFixture({prior});await assert.rejects(()=>run(f),e=>e.terminal===true);assert.equal(f.requests.length,0);assert.equal(names(f).length,1);
 });
test('lost Event finalize response remains no-send and no legacy claim',async()=>{
 const f=eventFixture({finalizeError:true});await assert.rejects(()=>run(f));assert.equal(f.requests.length,0);
 assert.equal(names(f).some(n=>n.startsWith('mz_')||n.includes('release')),false);
});
test('Event formatting error never finalizes or sends',async()=>{
 const f=eventFixture();f.eventBody=()=>{throw Error('missing required operational detail');};await assert.rejects(()=>run(f));
 assert.equal(names(f).includes('custodial_native_alert_finalize'),false);assert.equal(f.requests.length,0);
});
for(const option of ['recordError','recordThrow'])test('lost Event outcome '+option+' reads exact original receipt once',async()=>{
 const f=eventFixture({[option]:true});assert.equal((await run(f)).replayed,true);assert.equal(f.requests.length,1);
});
test('conflicting Event readback remains unresolved',async()=>{
 const f=eventFixture({recordError:true,recordTransform:v=>({...v,attempt_id:id(66)})});
 await assert.rejects(()=>run(f),e=>e.code==='native_event_outcome_reconciliation_pending');assert.equal(f.requests.length,1);
});
for(const [label,fetchImpl]of [['throw',async()=>{throw Error('synthetic loss');}],['malformed',async()=>new Response('bad')],
 ['wrong project',async()=>new Response(JSON.stringify({name:'projects/foreign-zoo/messages/one'}))],['oversized',async()=>new Response('x'.repeat(16385))]])
 test('ambiguous Event provider '+label+' is durable unknown, without resend',async()=>{const f=eventFixture({fetchImpl});await assert.rejects(()=>run(f),e=>e.terminal===true);assert.equal(f.requests.length,1);assert.equal(f.ledger.provider_outcome,'delivery_outcome_unknown');});
test('Event sender cannot be reused after a failed binding',async()=>{
 const f=eventFixture(),p=permit(f);let calls=0;const send=prepareNativeEventDataSender({projectId:'synthetic-zoo',accessToken:'synthetic',fetchImpl:async()=>{calls++;throw Error('not reached');}});
 const input={permit:p,jobId:f.job.job_id,leaseToken:f.job.lease_token,expected:f.expected,token:'crossed'};
 await assert.rejects(()=>send(input));input.token=f.token;await assert.rejects(()=>send(input),e=>e.code==='native_event_sender_already_consumed');assert.equal(calls,0);
});
