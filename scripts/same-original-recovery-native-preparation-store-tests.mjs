import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Recording private ports ONLY. No handle below is an authenticated native
// capture; SQL, current rights and native signing are NOT exercised.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),backend=process.argv[2];
assert.ok(backend&&path.isAbsolute(backend));
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
function pinned(file,digest){const bytes=fs.readFileSync(file);assert.equal(sha(bytes),digest,file);return bytes.toString('utf8');}
const pins={
  'src/native-private-custody-exchange.js':'428afacafe7f3cde828694cdb35c1433a168f1f26eeb8a88414fd82115a21362',
  'src/same-original-recovery-native-challenge-wire.js':'dcb2d4cb6b352549e1a1247a0165e8418bc2c6763c43746929f0e0a7a8404eb3',
  'src/same-original-recovery-wire.js':'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7',
  'src/native-provider-json.js':'8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294',
  'supabase/migrations/20261014143050_same_original_current_manager_preparation_read.sql':'10eea4b25e210d345382f7c89c3a82fda2273a3b486532ffe6fc70cb5d39bd2e',
};
for(const [file,digest] of Object.entries(pins))pinned(backend+'/'+file,digest);
const exchangeSource=fs.readFileSync(backend+'/src/native-private-custody-exchange.js','utf8');
assert.ok(exchangeSource.includes('export function inspectAuthenticatedSameOriginalRecoveryNativePreparation(capture)'));
const url=pathToFileURL(root+'/src/same-original-recovery-native-preparation-store.js').href;
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===url&&specifier.startsWith('./'))return next(pathToFileURL(path.join(backend,'src',specifier)).href,context);
  return next(specifier,context);
}});
const {createSameOriginalRecoveryNativePreparationStore:create}=await import(url);hook.deregister();
const wire=await import(pathToFileURL(backend+'/src/same-original-recovery-wire.js'));
const packet='/home/eric/Documents/Codex/2026-10-09/task-7/g08-native-challenge-envelope-20261014-v1';
pinned(packet+'/HANDOFF.json','eabbba8a663c1e3693c4d2521fe9becd7e8a408431b01569a36b89363515bd5a');
const vectors=pinned(packet+'/mobile/plugins/custodial-native-vault/android/src/test/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelopeTest.java','8cb99ed151ab75c85eecb28980d898cc34c694354af2ee1b176ca6e97e58aa9d');
const id=vectors.match(/String ID="([^"]+)"/)[1],other=vectors.match(/String OTHER="([^"]+)"/)[1],time=vectors.match(/String TIME="([^"]+)"/)[1];
function sourceObject(start,end){const at=vectors.indexOf(start);assert.ok(at>=0);const text=vectors.slice(at,vectors.indexOf(end,at)),value={};
  for(const match of text.matchAll(/for\(String key:new String\[\]\{([^}]+)\}\)value\.put\(key,(ID|SHA)\)/g))
    for(const key of [...match[1].matchAll(/"([A-Za-z0-9_.-]+)"/g)].map(v=>v[1]))value[key]=match[2]==='ID'?id:'a'.repeat(64);
  for(const match of text.matchAll(/\.put\("([^"]+)","([^"]+)"\)/g))value[match[1]]=match[2];return value;}
const target=Object.freeze(sourceObject('private static JSONObject targetJson()','private static NativeSameOriginalRecoveryPreparationWire.UntrustedTarget target()'));
const query=sourceObject('private static JSONObject query()','private static JSONObject outer(');
function fixture(){
  const current={schema:'custodial.original-private-custody-current-query.v1',original_query_body_base64:Buffer.from(JSON.stringify(query)).toString('base64'),
    original_query_timestamp:time,original_query_http_attestation:'a'.repeat(64),original_query_unknown_record_sha256:'b'.repeat(64)};
  const original={schema:'custodial.same-original-recovery-native-challenge.v1',purpose:wire.recoveryPreparationPurpose,
    native_challenge_intent_id:other,native_challenge_intent_record_sha256:'a'.repeat(64),
    current_original_query_envelope_base64:Buffer.from(JSON.stringify(current)).toString('base64'),original_target:target,original_target_sha256:wire.recoveryDocumentSha256('target',target)};
  const raw=' \n'+JSON.stringify(original,null,2)+'\t ',capture=Object.freeze({SYNTHETIC_RECORDING_PORT_HANDLE_ONLY:true});
  const params=Object.freeze({p_operation:target.operation_id,p_device:target.canonical_device_pk,p_credential:target.credential_id,
    p_credential_hash:'c'.repeat(64),p_credential_key_id:target.original_credential_secret_key_id,p_generation:target.original_generation_id,
    p_chunk_index:0,p_original_write_request:id,p_original_write_body_sha256:'d'.repeat(64),p_original_write_attestation_digest:'e'.repeat(64),
    p_native_request:other,p_native_request_timestamp:time,p_native_request_body_sha256:sha(raw),p_native_attestation_digest:'f'.repeat(64),p_original_utf8:raw});
  const binding=Object.freeze({capture,observation_only:true,transaction_authority:false,original_request_utf8:raw,original_target:target,
    native_challenge_intent_id:other,native_challenge_intent_record_sha256:original.native_challenge_intent_record_sha256,rpc_parameters:params});
  const bindings=new WeakMap([[capture,binding]]),calls=[];
  const registration={schema:'custodial.same-original-recovery-native-challenge-receipt.v1',state:'ORIGINAL_CHALLENGE_RECORDED_PREPARATION_ONLY',
    challenge_id:other,challenge_sha256:'a'.repeat(64),original_target_sha256:original.original_target_sha256,native_challenge_intent_id:other,
    native_challenge_intent_record_sha256:original.native_challenge_intent_record_sha256,registered_at:'2000-02-29T12:34:56.007000Z',
    expires_at:'2000-02-29T12:39:56.007000Z',retry_safe:false,limits:{...wire.recoveryDeniedEffects}};
  registration.challenge_sha256=sha(['custodial.same-original-native-challenge-binding.v1',other,params.p_native_request_body_sha256,
    params.p_native_attestation_digest,original.native_challenge_intent_record_sha256,original.original_target_sha256,registration.registered_at,registration.expires_at].join('\n'));
  const preview={schema:'custodial.same-original-recovery-review.v1',state:'ORIGINAL_BINDING_REVIEW_ONLY',purpose:wire.recoveryPreparationPurpose,
    challenge_id:other,challenge_sha256:registration.challenge_sha256,preview_sha256:'a'.repeat(64),original_target:target,expires_at:registration.expires_at,limits:{...wire.recoveryDeniedEffects}};
  preview.preview_sha256=wire.recoveryDocumentSha256('preview',preview);
  const request={schema:'custodial.same-original-recovery-approval-request.v1',request_id:id,challenge_id:other,
    expected_challenge_sha256:registration.challenge_sha256,expected_preview_sha256:preview.preview_sha256,
    expected_manager_id:id,expected_manager_credential_id:other,expected_manager_device_id:'SYN_MANAGER_SOURCE_ONLY',
    decision:wire.recoveryPreparationPurpose,manager_confirmation:'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
  const approval={schema:'custodial.same-original-recovery-approval-receipt.v1',state:'APPROVAL_RECORDED_ONLY',approval_id:id,
    original_request:request,original_request_sha256:wire.recoveryDocumentSha256('request',request),issuer:{manager_id:id,manager_credential_id:other,manager_device_id:'SYN_MANAGER_SOURCE_ONLY'},
    challenge_sha256:registration.challenge_sha256,preview_sha256:preview.preview_sha256,original_target:target,purpose_admission_id:'same-original-preparation.v1',
    issued_at:'2000-02-29T12:35:00.000000Z',expires_at:'2000-02-29T12:39:00.000000Z',receipt_sha256:'a'.repeat(64),retry_safe:false,limits:{...wire.recoveryDeniedEffects}};
  approval.receipt_sha256=wire.recoveryDocumentSha256('receipt',approval);
  const value={schema:'custodial.same-original-current-manager-preparation.v1',state:'CURRENT_MANAGER_PREPARATION_OBSERVED_NO_EFFECT_RIGHTS',
    purpose_admission_id:'same-original-preparation.v1',original_registration_utf8:' \n'+JSON.stringify(registration)+'\t',
    original_approval_receipt_utf8:' \n'+JSON.stringify(approval)+'\t',observed_at:'2000-02-29T12:35:01.000000Z',current_until:approval.expires_at,
    transaction_authority:false,limits:{...wire.recoveryDeniedEffects}};
  let response={data:JSON.stringify(value),error:null},inspections=0;
  const dependencies={db:{async rpc(name,args){calls.push({name,args});return response;}},inspectAuthenticatedNativePreparationRead(handle){
    inspections++;if(!bindings.has(handle))throw Error('SYNTHETIC_UNBOUND');return bindings.get(handle);}};
  return {capture,params,binding,bindings,calls,raw,registration,approval,value,dependencies,
    create(){return create(dependencies);},response(next){response=next;},inspections(){return inspections;}};
}
const cases=[];
async function test(name,body){if(process.argv[3]&&process.argv[3]!==name)return;
  try{await body();cases.push({name,passed:true});console.log('PASS '+name);}
  catch(error){cases.push({name,passed:false,error:error.code??error.name});console.error('FAIL '+name+' '+(error.code??error.name));process.exitCode=1;}}
function unknown(error){assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);assert.deepEqual(error.limits,wire.recoveryDeniedEffects);return true;}
function mutateApproval(f,change){const value=structuredClone(f.approval);change(value);
  value.original_request_sha256=wire.recoveryDocumentSha256('request',value.original_request);value.receipt_sha256=wire.recoveryDocumentSha256('receipt',value);
  return {...f.value,original_approval_receipt_utf8:JSON.stringify(value)};}
await test('PREPARATION_NEW fixed single read preserves original raw and private parameters',async()=>{
  const f=fixture(),store=f.create();assert.ok(Object.isFrozen(store));assert.deepEqual(Object.keys(store),['readCurrentManagerPreparationOnce']);
  const result=await store.readCurrentManagerPreparationOnce(f.capture);assert.deepEqual(result,f.value);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.limits));
  assert.equal(Object.keys(result).length,9);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'custodial_same_original_current_manager_preparation_v1');
  assert.strictEqual(f.calls[0].args,f.params);assert.equal(f.calls[0].args.p_original_utf8,f.raw);assert.equal(f.inspections(),2);
  for(const key of ['capture','rpc_parameters','db','authenticated','approved','retry_safe'])assert.ok(!Object.hasOwn(result,key));
  await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,1);
});
await test('PREPARATION_NEW absent extra accessor proxy or alternate dependencies denied',async()=>{
  const f=fixture();for(const value of [undefined,{}, {db:f.dependencies.db},{...f.dependencies,role:'service_role'},
    {...f.dependencies,inspectAuthenticatedNativePreparationRead:null}])assert.throws(()=>create(value),unknown);
  let traps=0;const accessor={db:f.dependencies.db};Object.defineProperty(accessor,'inspectAuthenticatedNativePreparationRead',{enumerable:true,get(){traps++;throw Error('TRAP');}});
  assert.throws(()=>create(accessor),unknown);const proxy=new Proxy(f.dependencies,{get(){traps++;throw Error('TRAP');},getPrototypeOf(){traps++;throw Error('TRAP');}});
  assert.throws(()=>create(proxy),unknown);assert.equal(traps,0);assert.equal(f.calls.length,0);
});
await test('PREPARATION_NEW copied closed wrong handle and binding flags never read SQL',async()=>{
  const f=fixture();await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce({...f.capture}),unknown);assert.equal(f.calls.length,0);
  for(const delta of [{capture:Object.freeze({})},{transaction_authority:true},{observation_only:false},{extra:'not-admitted'}]){
    const x=fixture();x.bindings.set(x.capture,Object.freeze({...x.binding,...delta}));await assert.rejects(()=>x.create().readCurrentManagerPreparationOnce(x.capture),unknown);assert.equal(x.calls.length,0);}
});
await test('PREPARATION_NEW malformed original and year zero private timestamp stay UNKNOWN',async()=>{
  for(const invalid of ['body','timestamp']){const f=fixture();
    const raw=invalid==='body'?'{}':f.raw;
    f.bindings.set(f.capture,Object.freeze({...f.binding,original_request_utf8:raw,rpc_parameters:Object.freeze({...f.params,
      p_original_utf8:raw,p_native_request_body_sha256:sha(raw),p_native_request_timestamp:invalid==='timestamp'?'0000-01-01T00:00:00.000Z':time})}));
    await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,0);}
});
await test('PREPARATION_NEW lost NULL projected SDK data and errors consume read no fallback',async()=>{
  for(const value of [null,{data:null,error:null},{data:{},error:null},{data:JSON.stringify(fixture().value),error:{code:'40001'}}]){
    const f=fixture(),store=f.create();f.response(value);await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);
    await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,1);}
  const g=fixture();g.dependencies.db.rpc=async(name,args)=>{g.calls.push({name,args});throw Error('SYNTHETIC_REPLY_LOST');};const held=g.create();
  await assert.rejects(()=>held.readCurrentManagerPreparationOnce(g.capture),unknown);await assert.rejects(()=>held.readCurrentManagerPreparationOnce(g.capture),unknown);assert.equal(g.calls.length,1);
});
await test('PREPARATION_NEW definite42501 denied once without readaround',async()=>{
  for(const thrown of [false,true]){const f=fixture();f.dependencies.db.rpc=async(name,args)=>{f.calls.push({name,args});
    if(thrown)throw Object.assign(Error('SYNTHETIC_DENIED'),{code:'42501'});return {data:JSON.stringify(f.value),error:{code:'42501'}};};
    const store=f.create();await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),error=>{unknown(error);assert.equal(error.status,403);return true;});
    await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,1);}
});
await test('PREPARATION_NEW SDK accessors cannot hide errors or supply authority',async()=>{
  for(const key of ['error','data']){const f=fixture();let calls=0;
    const reply={data:JSON.stringify(f.value),error:null};Object.defineProperty(reply,key,{enumerable:true,get(){calls++;throw Error('TRAP');}});
    f.response(reply);const store=f.create();await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);
    assert.equal(calls,0);await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,1);}
});
await test('PREPARATION_NEW postawait closure raw change target or parameter drift retains unknown',async()=>{
  for(const change of ['close','raw','parameter','target']){const f=fixture();let release;f.dependencies.db.rpc=async(name,args)=>{f.calls.push({name,args});await new Promise(r=>release=r);return {data:JSON.stringify(f.value),error:null};};
    const store=f.create(),pending=store.readCurrentManagerPreparationOnce(f.capture);
    if(change==='close')f.bindings.delete(f.capture);
    else if(change==='raw'){const raw=f.raw+' ';f.bindings.set(f.capture,Object.freeze({...f.binding,original_request_utf8:raw,rpc_parameters:Object.freeze({...f.params,p_original_utf8:raw,p_native_request_body_sha256:sha(raw)})}));}
    else if(change==='parameter')f.bindings.set(f.capture,Object.freeze({...f.binding,rpc_parameters:Object.freeze({...f.params,p_native_attestation_digest:'1'.repeat(64)})}));
    else f.bindings.set(f.capture,Object.freeze({...f.binding,original_target:{...target,engine_revision:'9'}}));
    release();await assert.rejects(()=>pending,unknown);await assert.rejects(()=>store.readCurrentManagerPreparationOnce(f.capture),unknown);assert.equal(f.calls.length,1);}
});
await test('PREPARATION_NEW SQL duplicates malformed UTF8 representation and caps refuse',async()=>{
  const f=fixture(),text=JSON.stringify(f.value);
  for(const data of ['\ufeff'+text,'\ud800'+text,'{"schema":"duplicate",'+text.slice(1),text+' {}',text+' '.repeat(65536),JSON.stringify({...f.value,transaction_authority:true}),JSON.stringify({...f.value,extra:'authority'})]){
    const x=fixture();x.response({data,error:null});await assert.rejects(()=>x.create().readCurrentManagerPreparationOnce(x.capture),unknown);}
  const g=fixture();g.response({data:JSON.stringify(g.value)+' '.repeat(65536-Buffer.byteLength(JSON.stringify(g.value))),error:null});assert.deepEqual(await g.create().readCurrentManagerPreparationOnce(g.capture),g.value);
});
await test('PREPARATION_NEW receipt byte caps duplicates and object projection refuse',async()=>{
  for(const field of ['original_registration_utf8','original_approval_receipt_utf8']){
    for(const raw of [null,{},'{"schema":"duplicate",'+fixture().value[field].trim().slice(1),fixture().value[field]+' '.repeat(24576)]){
      const f=fixture();f.response({data:JSON.stringify({...f.value,[field]:raw}),error:null});await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);}
    const f=fixture(),raw=f.value[field]+' '.repeat(24576-Buffer.byteLength(f.value[field]));f.response({data:JSON.stringify({...f.value,[field]:raw}),error:null});
    assert.equal((await f.create().readCurrentManagerPreparationOnce(f.capture))[field],raw);
  }
});
await test('PREPARATION_NEW native registration intent record target transcript refuse',async()=>{
  for(const delta of [{challenge_id:id},{native_challenge_intent_id:id},{native_challenge_intent_record_sha256:'b'.repeat(64)},
    {original_target_sha256:'b'.repeat(64)},{challenge_sha256:'b'.repeat(64)}]){const f=fixture();f.response({data:JSON.stringify({...f.value,original_registration_utf8:JSON.stringify({...f.registration,...delta})}),error:null});
    await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);}
});
await test('PREPARATION_NEW approval original target challenge preview and digest refuse',async()=>{
  const changes=[a=>a.original_target={...target,engine_revision:'1'},a=>a.original_request.challenge_id=id,
    a=>{a.challenge_sha256='b'.repeat(64);a.original_request.expected_challenge_sha256=a.challenge_sha256;},
    a=>{a.preview_sha256='b'.repeat(64);a.original_request.expected_preview_sha256=a.preview_sha256;}];
  for(const change of changes){const f=fixture();f.response({data:JSON.stringify(mutateApproval(f,change)),error:null});await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);}
  const f=fixture();f.response({data:JSON.stringify({...f.value,original_approval_receipt_utf8:JSON.stringify({...f.approval,receipt_sha256:'b'.repeat(64)})}),error:null});await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);
});
await test('PREPARATION_NEW original expiry current until and civil precision refuse renewal',async()=>{
  for(const delta of [{observed_at:fixture().value.current_until},{current_until:'2000-02-29T12:39:56.008000Z'},
    {observed_at:'2000-02-29T12:34:59.000000Z'},{observed_at:'0000-01-01T00:00:00.000000Z'},
    {current_until:'2000-02-29T12:39:00.000Z'},{current_until:fixture().value.current_until+'\n'}]){const f=fixture();f.response({data:JSON.stringify({...f.value,...delta}),error:null});await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);}
});
await test('PREPARATION_NEW every effect remains false no response private authority',async()=>{
  for(const key of Object.keys(wire.recoveryDeniedEffects)){const f=fixture();f.response({data:JSON.stringify({...f.value,limits:{...f.value.limits,[key]:true}}),error:null});await assert.rejects(()=>f.create().readCurrentManagerPreparationOnce(f.capture),unknown);}
  const f=fixture(),result=await f.create().readCurrentManagerPreparationOnce(f.capture);assert.equal(result.transaction_authority,false);assert.deepEqual(result.limits,wire.recoveryDeniedEffects);
  for(const key of ['rpc_parameters','capture','token','original_request_utf8'])assert.ok(!Object.hasOwn(result,key));
});
console.log(JSON.stringify({scope:'RECORDING_OPAQUE_INSPECTOR_AND_RPC_SOURCE_ONLY_NOT_NATIVE_AUTH_SQL',cases,
  actual_preparation_capture:false,SQL:false,HTTP:false,JVM:false,current_manager_auth:false,effect_rights:false,resources:{listeners:0,child_processes:0}}));
