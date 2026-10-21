import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {verifyFeedbackAttachmentForRelay,FeedbackAttachmentAdmissionError} from '../src/feedback-attachment-admission.js';
import {callFeedbackRelay,FEEDBACK_RELAY_CONTRACT,FEEDBACK_RELAY_SCHEMA_SHA256} from '../src/feedback-email-relay.js';
import {createClient} from '@supabase/supabase-js';

async function currentRelayAuthorityCases(){
  const authority=()=>({authInfo:{clientId:'authority-fixture',scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'https://fixture.invalid',subject:'original-relay'}}});
  const request=()=>({contract_version:FEEDBACK_RELAY_CONTRACT,request_id:randomUUID(),intent_id:randomUUID(),claim_token:randomUUID(),claim_generation:1,envelope_sha256:'a'.repeat(64)});
  let checks=0;
  for(const change of ['principal','scope','expiry']){
    const extra=authority(),calls=[];
    const client={rpc:async name=>{calls.push(name);if(name==='custodial_feedback_relay_attachment_internal'){
      if(change==='principal')extra.authInfo.extra.subject='changed-relay';
      if(change==='scope')extra.authInfo.scopes=['mcp:read'];
      if(change==='expiry')extra.authInfo.expiresAt=1;
      return {data:{status:'no_attachment'}};
    }return {data:{ok:true,may_send:true}};}};
    await assert.rejects(()=>callFeedbackRelay('begin',request(),extra,{client}),/authorization|principal|expired/);checks++;
    assert.deepEqual(calls,['custodial_feedback_relay_attachment_internal'],'changed current authority cannot reach begin');checks++;
  }
  const extra=authority();let calls=0;
  await assert.rejects(()=>callFeedbackRelay('begin',request(),extra,{client:{rpc:async name=>{calls++;
    if(name==='custodial_feedback_relay_attachment_internal')return {data:{status:'no_attachment'}};
    extra.authInfo.expiresAt=1;return {data:{ok:true,may_send:true}};
  }}}),/expired/);checks++;
  assert.equal(calls,2,'possibly committed begin is not repeated');checks++;
  const denied=authority();denied.authInfo.expiresAt=1;calls=0;
  await assert.rejects(()=>callFeedbackRelay('begin',request(),denied,{client:{rpc:async()=>{calls++;}}}),/expired/);checks++;
  assert.equal(calls,0);checks++;
  const stableCalls=[];
  assert.equal((await callFeedbackRelay('begin',request(),authority(),{client:{rpc:async name=>{stableCalls.push(name);return {data:name==='custodial_feedback_relay_attachment_internal'?{status:'no_attachment'}:{ok:true,may_send:true}};}}})).may_send,true);checks++;
  assert.equal(stableCalls.length,2);checks++;
  for(const downloadFails of [false,true]){
    const changing=authority(),calls=[],data=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    const sha256=createHash('sha256').update(data).digest('hex'),operation_id=randomUUID(),ticket=randomUUID();
    const client={storage:{from:()=>({download:()=>({asStream:async()=>{
      changing.authInfo.scopes=['mcp:read'];
      if(downloadFails)throw Error('synthetic read failure');
      return {data:new Blob([data]).stream()};
    }})})},rpc:async(name,args)=>{calls.push({name,action:args.p_action});return {data:{status:'ready',ticket,operation_id,
      image:{type:'image/png',size:data.length,sha256,storage_bucket:'system-feedback-private',storage_path:`feedback/${operation_id}/${sha256}.png`}}};}};
    await assert.rejects(()=>callFeedbackRelay('begin',request(),changing,{client}),/read and write/);checks++;
    assert.deepEqual(calls,[{name:'custodial_feedback_relay_attachment_internal',action:'prepare'}],'authority lost during historical attachment read cannot complete/reject/begin');checks++;
  }
  console.log(JSON.stringify({status:'FEEDBACK_CURRENT_RELAY_AUTHORITY_PASS',checks,at_utc:new Date().toISOString(),rpc_synthetic:true,mail_sent:false,actual_authentication:false}));
}
if(process.argv.includes('--authority-boundary-only')){await currentRelayAuthorityCases();process.exit(0);}

const bytes=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('protected fixture')]);
const digest=createHash('sha256').update(bytes).digest('hex');
const operation=randomUUID();
const path=`feedback/${operation}/${digest}.png`;
const bucket='system-feedback-private';
let downloads=0;
const stored={operation_id:operation,image:{type:'image/png',size:bytes.length,sha256:digest,storage_bucket:bucket,storage_path:path}};
const streamClient=make=>({storage:{from:()=>({download:()=>({asStream:make})})}});
const client={storage:{from(name){assert.equal(name,bucket);return {download:(p,_options,parameters)=>({asStream:async()=>{downloads++;assert.equal(p,path);assert.ok(parameters.signal instanceof AbortSignal);return {data:new Blob([bytes]).stream()};}})};}}};
const assertDisposition=async(promise,disposition)=>assert.rejects(promise,error=>error instanceof FeedbackAttachmentAdmissionError&&error.disposition===disposition);
assert.deepEqual(await verifyFeedbackAttachmentForRelay(stored,{client,privateBucket:bucket}),{sha256:digest,size:bytes.length,type:'image/png'});
assert.equal(downloads,1);
assert.deepEqual(await verifyFeedbackAttachmentForRelay({...stored,image:{...stored.image,sha256:undefined}},{client,privateBucket:bucket}),{sha256:digest,size:bytes.length,type:'image/png'},'legacy canonical path provides immutable digest');
const inline={operation_id:operation,image:{type:'image/png',size:bytes.length,data_url:`data:image/png;base64,${bytes.toString('base64')}`}};
assert.deepEqual(await verifyFeedbackAttachmentForRelay(inline),{sha256:digest,size:bytes.length,type:'image/png'},'legacy inline object needs no storage');
await assertDisposition(verifyFeedbackAttachmentForRelay({...stored,image:{...stored.image,sha256:'a'.repeat(64)}},{client,privateBucket:bucket}),'corrupt');
await assertDisposition(verifyFeedbackAttachmentForRelay({...stored,image:{...stored.image,size:bytes.length+1}},{client,privateBucket:bucket}),'corrupt');
await assertDisposition(verifyFeedbackAttachmentForRelay({...stored,image:{...stored.image,type:'image/jpeg'}},{client,privateBucket:bucket}),'corrupt');
await assertDisposition(verifyFeedbackAttachmentForRelay(stored,{client:streamClient(async()=>({error:{status:404}})),privateBucket:bucket}),'missing');
await assertDisposition(verifyFeedbackAttachmentForRelay(stored,{client:streamClient(async()=>{throw Error('unavailable');}),privateBucket:bucket}),'configuration_unavailable');
await assertDisposition(verifyFeedbackAttachmentForRelay(stored,{client:streamClient(async()=>({data:new Blob([Buffer.alloc(5*1024*1024+1)]).stream()})),privateBucket:bucket}),'corrupt');
let canceled=false;
const oversizedStream=new ReadableStream({pull(controller){controller.enqueue(Buffer.alloc(3*1024*1024));},cancel(){canceled=true;}});
await assertDisposition(verifyFeedbackAttachmentForRelay(stored,{client:streamClient(async()=>({data:oversizedStream})),privateBucket:bucket}),'corrupt');
assert.equal(canceled,true,'oversized network body is canceled, not merely unlocked');
let actualRequests=0;
const actualClient=createClient('https://feedback-storage-fixture.invalid','synthetic-only-service-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
  actualRequests++;assert.ok(String(url).endsWith('/storage/v1/object/'+bucket+'/'+path));assert.ok(options.signal instanceof AbortSignal);
  const response=new Response(new Blob([bytes]).stream(),{status:200,headers:{'Content-Type':'image/png'}});
  response.blob=()=>{throw Error('Whole-object buffering is prohibited.');};return response;
}}});
assert.deepEqual(await verifyFeedbackAttachmentForRelay(stored,{client:actualClient,privateBucket:bucket}),{sha256:digest,size:bytes.length,type:'image/png'});
assert.equal(actualRequests,1,'installed Supabase SDK uses bounded stream without external network');

const extra={authInfo:{clientId:'private-fixture',scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'https://fixture.invalid',subject:'fixture'}}};
const fence={contract_version:FEEDBACK_RELAY_CONTRACT,request_id:randomUUID(),intent_id:randomUUID(),claim_token:randomUUID(),claim_generation:1,envelope_sha256:'b'.repeat(64)};
let calls=[];
const service={storage:client.storage,rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='custodial_feedback_relay_attachment_internal')return {data:args.p_action==='prepare'?{status:'ready',ticket:randomUUID(),...stored}:{status:'verified'},error:null};
  if(name==='custodial_feedback_relay_begin')return {data:{ok:true,may_send:true,attempt_id:randomUUID()},error:null};
  throw Error(`Unexpected RPC ${name}`);
}};
const result=await callFeedbackRelay('begin',fence,extra,{client:service});
assert.equal(result.may_send,true);
assert.deepEqual(calls.map(c=>c.name),['custodial_feedback_relay_attachment_internal','custodial_feedback_relay_attachment_internal','custodial_feedback_relay_begin']);
assert.equal(calls[1].args.p_action,'complete');
assert.deepEqual(calls[1].args.p_args.observed,{sha256:digest,size:bytes.length,type:'image/png'});
assert.ok(calls[0].args.p_args.adapter_schema_sha256===FEEDBACK_RELAY_SCHEMA_SHA256);
assert.ok(!JSON.stringify(result).includes(path)&&!JSON.stringify(result).includes(bytes.toString('base64')));
calls=[];
const unavailableService={...service,...streamClient(async()=>{throw Error('offline');}),rpc:async(name,args)=>{
  calls.push({name,args});
  return {data:name==='custodial_feedback_relay_attachment_internal'?(args.p_action==='prepare'?{status:'ready',ticket:randomUUID(),...stored}:{status:'paused'}):{ok:true,may_send:true},error:null};
}};
assert.deepEqual(await callFeedbackRelay('begin',{...fence,request_id:randomUUID()},extra,{client:unavailableService}),{ok:false,may_send:false,needs_attention:false,paused:true});
assert.deepEqual(calls.map(c=>c.name),['custodial_feedback_relay_attachment_internal','custodial_feedback_relay_attachment_internal'],'transport outage never reaches public begin');
assert.equal(calls[1].args.p_args.disposition,'configuration_unavailable');
calls=[];
const textService={rpc:async(name,args)=>{calls.push(name);return {data:name==='custodial_feedback_relay_attachment_internal'?{status:'no_attachment'}:{ok:true,may_send:true},error:null};}};
assert.equal((await callFeedbackRelay('begin',{...fence,request_id:randomUUID()},extra,{client:textService})).may_send,true);
assert.deepEqual(calls,['custodial_feedback_relay_attachment_internal','custodial_feedback_relay_begin'],'text-only path remains available');
console.log(JSON.stringify({status:'FEEDBACK_ATTACHMENT_ADMISSION_TESTS_PASS',checks:22,actualStorageSdk:true,network:'intercepted',external_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256,provider_called:false}));
