import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

// New decoder checks from the ACTUAL sealed Java test SOURCE vectors. No toy
// encoder, Java execution/emitted-byte parity, HMAC or native provenance PASS.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),backend=process.argv[2];
assert.ok(backend&&path.isAbsolute(backend));
const packet='/home/eric/Documents/Codex/2026-10-09/task-7/g08-native-challenge-envelope-20261014-v1';
const javaRoot=packet+'/mobile/plugins/custodial-native-vault/android/src/';
const sha=value=>createHash('sha256').update(value).digest('hex');
function readPinned(file,digest){const bytes=fs.readFileSync(file);assert.equal(sha(bytes),digest,file);return bytes.toString('utf8');}
readPinned(packet+'/HANDOFF.json','eabbba8a663c1e3693c4d2521fe9becd7e8a408431b01569a36b89363515bd5a');
const encoder=readPinned(javaRoot+'main/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelope.java',
  '31743a79877a5c0bf2ae625826e5a0b6ec56d7ac772333497159a26b49a078b4');
const vectors=readPinned(javaRoot+'test/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelopeTest.java',
  '8cb99ed151ab75c85eecb28980d898cc34c694354af2ee1b176ca6e97e58aa9d');
const wireFile=backend+'/src/same-original-recovery-wire.js',currentFile=backend+'/src/native-private-custody-current-query-wire.js';
const statusOnly=process.argv[3]==='--native-status-new';
readPinned(wireFile,statusOnly?'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7':
  'dc79e4f3a7f137c5ea159b1f2b909e864378497c67259f862c27cc9e233335cb');
readPinned(currentFile,'0e49384067113b3849a03bab8a075894c0782ce1ec8e13465f453c759d7123b9');
const nativeCurrent=readPinned(path.dirname(backend)+'/frontend/mobile/plugins/custodial-native-vault/android/src/main/java/org/memphiszoo/custodial/vault/NativePrivateCustodyCurrentQueryEnvelope.java',
  'c2b0f8559dbdc505e2c5af92a11e09b0c501d972f70e0bf8fd2645965e5d39a1');
const moduleUrl=pathToFileURL(root+'/src/same-original-recovery-native-challenge-wire.js').href;
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===moduleUrl&&specifier==='./same-original-recovery-wire.js')return next(pathToFileURL(wireFile).href,context);
  if(context.parentURL===moduleUrl&&specifier==='./native-private-custody-current-query-wire.js')return next(pathToFileURL(currentFile).href,context);
  return next(specifier,context);
}});
const {decodeSameOriginalRecoveryNativeChallenge:decode,decodeSameOriginalRecoveryNativeStatus:decodeStatus}=await import(moduleUrl);
const wire=await import(pathToFileURL(wireFile));hook.deregister();
const literals=text=>[...text.matchAll(/"([A-Za-z0-9_.-]+)"/g)].map(match=>match[1]);
const id=vectors.match(/String ID="([^"]+)"/)[1],other=vectors.match(/String OTHER="([^"]+)"/)[1],time=vectors.match(/String TIME="([^"]+)"/)[1];
assert.ok(vectors.includes('String SHA="a".repeat(64),OTHER_SHA="b".repeat(64)'));
const values={ID:id,SHA:'a'.repeat(64)};
function sourceObject(start,end){
  const begin=vectors.indexOf(start);assert.ok(begin>=0);const text=vectors.slice(begin,vectors.indexOf(end,begin));const result={};
  for(const match of text.matchAll(/for\(String key:new String\[\]\{([^}]+)\}\)value\.put\(key,(ID|SHA)\)/g))
    for(const key of literals(match[1]))result[key]=values[match[2]];
  for(const match of text.matchAll(/\.put\("([^"]+)","([^"]+)"\)/g))result[match[1]]=match[2];
  return result;
}
const target=sourceObject('private static JSONObject targetJson()','private static NativeSameOriginalRecoveryPreparationWire.UntrustedTarget target()');
const query=sourceObject('private static JSONObject query()','private static JSONObject outer(');
const pins=literals(encoder.match(/TARGET_PINS=\{([^}]+)\}/)[1]);
assert.deepEqual(Object.keys(query).sort(),literals(nativeCurrent.match(/QUERY_KEYS=\{([^}]+)\}/)[1]).sort());
assert.deepEqual(wire.validateRecoveryOriginalTarget(target),target);
assert.equal(time,'2000-02-29T12:34:56.007Z');
const schema=encoder.match(/SCHEMA="([^"]+)"/)[1];assert.equal(schema,'custodial.same-original-recovery-native-challenge.v1');
assert.ok(encoder.includes('MAX_OUTPUT=786432'));assert.equal(pins.length,8);
function current(original=Buffer.from(JSON.stringify(query))){return Buffer.from(JSON.stringify({schema:'custodial.original-private-custody-current-query.v1',
  original_query_body_base64:original.toString('base64'),original_query_timestamp:time,
  original_query_http_attestation:'a'.repeat(64),original_query_unknown_record_sha256:'b'.repeat(64)}));}
function challenge(currentBytes=current(),originalTarget=target){return {schema,purpose:wire.recoveryPreparationPurpose,
  native_challenge_intent_id:other,native_challenge_intent_record_sha256:'a'.repeat(64),
  current_original_query_envelope_base64:currentBytes.toString('base64'),original_target:structuredClone(originalTarget),
  original_target_sha256:wire.recoveryDocumentSha256('target',originalTarget)};}
const bytes=value=>Buffer.from(JSON.stringify(value));
const errorCode='same_original_recovery_native_challenge_wire_invalid';
function rejects(input){const before=Buffer.isBuffer(input)?Buffer.from(input):null;assert.throws(()=>decode(input),{code:errorCode});
  if(before)assert.deepEqual(input,before);}
const cases=[],select=process.argv[3];
function test(name,body){if(select&&select!==name)return;try{body();cases.push({name,passed:true});console.log('PASS '+name);}
  catch(error){cases.push({name,passed:false,error:error.code??error.name,cause:error.cause?.name??null});
    console.error('FAIL '+name+' '+(error.code??error.name)+' '+(error.cause?.name??''));process.exitCode=1;}}
if(statusOnly){
  const statusSchema='custodial.same-original-recovery-native-status.v1',statusCode='same_original_recovery_native_status_wire_invalid';
  const original=Buffer.from(' \n'+JSON.stringify(challenge())+'\t ');
  const status=()=>({schema:statusSchema,purpose:'OBSERVE_ORIGINAL_REGISTRATION_ONLY',
    original_challenge_body_base64:original.toString('base64'),original_challenge_timestamp:time,
    original_challenge_http_attestation:'a'.repeat(64)});
  function statusReject(input){const before=Buffer.isBuffer(input)?Buffer.from(input):null;
    assert.throws(()=>decodeStatus(input),{code:statusCode});if(before)assert.deepEqual(input,before);}
  function statusTest(name,body){if(process.argv[4]&&process.argv[4]!==name)return;
    try{body();cases.push({name,passed:true});console.log('PASS '+name);}
    catch(error){cases.push({name,passed:false,error:error.code??error.name});console.error('FAIL '+name+' '+(error.code??error.name));process.exitCode=1;}}
  statusTest('STATUS_NEW exact original bytes frozen closed observation only',()=>{
    const body=status(),input=bytes(body),before=Buffer.from(input),result=decodeStatus(input);
    assert.deepEqual(result,body);assert.ok(Object.isFrozen(result));assert.equal(Object.keys(result).length,5);
    assert.deepEqual(Buffer.from(result.original_challenge_body_base64,'base64'),original);assert.deepEqual(input,before);
    input.fill(0);assert.deepEqual(result,body);
    for(const key of ['authenticated','approved','inventory_acknowledged','work_accepted','retry_safe','finalizer_allowed','key_removal'])assert.ok(!Object.hasOwn(result,key));
  });
  statusTest('STATUS_NEW missing foreign purpose type and scalar refusal',()=>{
    const body=status();for(const key of Object.keys(body)){const missing={...body};delete missing[key];statusReject(bytes(missing));}
    for(const delta of [{schema:'foreign.v1'},{purpose:wire.recoveryPreparationPurpose},{approved:'true'},
      {original_challenge_http_attestation:'A'.repeat(64)},{original_challenge_http_attestation:'a'.repeat(64)+'\n'},
      {original_challenge_timestamp:0},{original_challenge_body_base64:{}}])statusReject(bytes({...body,...delta}));
    for(const value of [null,[],true,0,'scalar'])statusReject(bytes(value));
  });
  statusTest('STATUS_NEW duplicates UTF8 BOM Unicode and trailing refusal',()=>{
    const text=JSON.stringify(status());for(const value of [Buffer.from('{"schema":"'+statusSchema+'",'+text.slice(1)),
      Buffer.from('{"\\u0073chema":"'+statusSchema+'",'+text.slice(1)),Buffer.from('\ufeff'+text),Buffer.from(text+' {}'),
      Buffer.concat([Buffer.from([0xff]),Buffer.from(text)]),Buffer.from(text.replace('a'.repeat(64),'\\ud800'))])statusReject(value);
    const nested=Buffer.from('{"schema":"'+schema+'",'+JSON.stringify(challenge()).slice(1));
    statusReject(bytes({...status(),original_challenge_body_base64:nested.toString('base64')}));
  });
  statusTest('STATUS_NEW actual civil UTC milliseconds only not freshness',()=>{
    for(const timestamp of ['2000-02-29T12:34:56.007Z','2099-12-31T23:59:59.999Z'])
      assert.equal(decodeStatus(bytes({...status(),original_challenge_timestamp:timestamp})).original_challenge_timestamp,timestamp);
    for(const timestamp of ['2026-02-29T12:34:56.007Z','2000-02-30T12:34:56.007Z','2026-13-01T00:00:00.000Z',
      '2026-10-14T24:00:00.000Z','2026-10-14T12:34:56.007000Z',time+'\n',time.replace('Z','+00:00'),'2026-10-14T12:34:60.000Z'])
      statusReject(bytes({...status(),original_challenge_timestamp:timestamp}));
  });
  statusTest('STATUS_NEW year zero refused by shared civil contract',()=>{
    assert.throws(()=>wire.recoveryInstantMicros('0000-01-01T00:00:00.000000Z'));
    statusReject(bytes({...status(),original_challenge_timestamp:'0000-01-01T00:00:00.000Z'}));
    assert.equal(wire.recoveryInstantMicros('0001-01-01T00:00:00.000000Z'),0n);
    assert.equal(decodeStatus(bytes({...status(),original_challenge_timestamp:'0001-01-01T00:00:00.000Z'}))
      .original_challenge_timestamp,'0001-01-01T00:00:00.000Z');
  });
  statusTest('STATUS_NEW canonical base64 and unchanged nested challenge refusal',()=>{
    for(const encoded of ['',original.toString('base64')+' ','Zh==','-_=='])statusReject(bytes({...status(),original_challenge_body_base64:encoded}));
    for(const raw of [Buffer.from([0xff]),bytes({...challenge(),purpose:'REMOVE'}),bytes({...challenge(),original_target_sha256:'b'.repeat(64)})])
      statusReject(bytes({...status(),original_challenge_body_base64:raw.toString('base64')}));
  });
  statusTest('STATUS_NEW exact status and original caps borrowed bytes preserved',()=>{
    const body=bytes(status()),maximum=Buffer.concat([body,Buffer.alloc(1050624-body.length,32)]);
    assert.equal(decodeStatus(maximum).schema,statusSchema);statusReject(Buffer.concat([maximum,Buffer.from(' ')]));statusReject(Buffer.alloc(0));
    const maximumOriginal=Buffer.concat([original,Buffer.alloc(786432-original.length,32)]);
    const envelope=bytes({...status(),original_challenge_body_base64:maximumOriginal.toString('base64')});
    assert.ok(envelope.length<=1050624);assert.equal(decodeStatus(envelope).original_challenge_body_base64,maximumOriginal.toString('base64'));
    statusReject(bytes({...status(),original_challenge_body_base64:Buffer.concat([maximumOriginal,Buffer.from(' ')]).toString('base64')}));
  });
  statusTest('STATUS_NEW intrinsic input ownership ignores getter shadows',()=>{
    const body=status(),input=bytes(body);let calls=0;
    for(const key of ['buffer','byteOffset','byteLength','length'])Object.defineProperty(input,key,{get(){calls++;throw Error('SHADOW');}});
    assert.deepEqual(decodeStatus(input),body);assert.equal(calls,0);
  });
  statusTest('STATUS_NEW shared foreign proxy fake detached backing refusal',()=>{
    const input=bytes(status()),shared=Buffer.from(new SharedArrayBuffer(input.length));shared.set(input);
    Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(input.length)});assert.throws(()=>decodeStatus(shared),{code:statusCode});
    const foreign=vm.runInNewContext('new ArrayBuffer('+input.length+')');new Uint8Array(foreign).set(input);
    assert.throws(()=>decodeStatus(Buffer.from(foreign)),{code:statusCode});let traps=0;
    const proxy=new Proxy(input,{get(){traps++;throw Error('TRAP');},getPrototypeOf(){traps++;throw Error('TRAP');}});
    assert.throws(()=>decodeStatus(proxy),{code:statusCode});assert.equal(traps,0);
    assert.throws(()=>decodeStatus(Object.create(Buffer.prototype)),{code:statusCode});statusReject(new Uint8Array(input));
    const backing=new ArrayBuffer(input.length),detached=Buffer.from(backing);detached.set(input);structuredClone(backing,{transfer:[backing]});
    assert.throws(()=>decodeStatus(detached),{code:statusCode});
  });
}
test('DECODER_NEW sealed Java source vector exact7 UNTRUSTED fields and no authority',()=>{
  const body=challenge(),input=bytes(body),before=Buffer.from(input),result=decode(input);assert.deepEqual(result,body);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.original_target));assert.deepEqual(input,before);
  assert.equal(Object.keys(result).length,7);for(const field of ['approved','inventory_acknowledged','work_accepted','replay_allowed','finalizer_allowed','key_removal','phone_released'])
    assert.ok(!Object.hasOwn(result,field));
});
test('DECODER_NEW escaped source query key and whitespace nested bytes are never normalized',()=>{
  const original=Buffer.from(' \n'+JSON.stringify(query).replace('operation_id','\\u006fperation_id')+'\t ');
  const nested=Buffer.concat([Buffer.from(' \n'),current(original),Buffer.from('\t ')]),body=challenge(nested);
  const result=decode(bytes(body));assert.deepEqual(Buffer.from(result.current_original_query_envelope_base64,'base64'),nested);
  const decoded=JSON.parse(nested);assert.deepEqual(Buffer.from(decoded.original_query_body_base64,'base64'),original);
  assert.equal(decoded.original_query_timestamp,time);
});
test('DECODER_NEW each of eight source target pins mixed refuses',()=>{
  for(const pin of pins){const changed={...target,[pin]:pin==='engine_revision'?'1':['operation_id','original_generation_id'].includes(pin)?other:'b'.repeat(64)};
    rejects(bytes(challenge(current(),changed)));}
});
test('DECODER_NEW exact outer shape purpose types intent and target hash refuse',()=>{
  const valid=challenge();for(const delta of [{schema:'foreign.v1'},{purpose:'REMOVE'},{native_challenge_intent_id:id+'\n'},
    {native_challenge_intent_id:'not-intent'},{native_challenge_intent_record_sha256:'A'.repeat(64)},
    {original_target_sha256:'b'.repeat(64)},{approved:'true'},{original_target:[]},{original_target:null}])rejects(bytes({...valid,...delta}));
  for(const key of Object.keys(valid)){const missing={...valid};delete missing[key];rejects(bytes(missing));}
  for(const primitive of [[],false,0,null,'plain'])rejects(bytes(primitive));
});
test('DECODER_NEW duplicate escaped duplicate malformed unicode BOM and trailing refuse',()=>{
  const text=JSON.stringify(challenge());for(const input of [Buffer.from('{"schema":"'+schema+'",'+text.slice(1)),
    Buffer.from('{"\\u0073chema":"'+schema+'",'+text.slice(1)),Buffer.from('\ufeff'+text),Buffer.from(text+' {}'),
    Buffer.concat([Buffer.from([0xff]),Buffer.from(text)]),Buffer.from(text.replace(other,'\\ud800')),
    Buffer.from(text.replace('"operation_id":','"operation_id":"'+id+'","operation_id":'))])rejects(input);
});
test('DECODER_NEW nested duplicate type field WRITE and archived timestamp refusal',()=>{
  const flat=JSON.stringify(query);
  for(const original of [Buffer.from('{"operation_id":"'+id+'",'+flat.slice(1)),bytes({...query,engine_revision:0}),
    bytes({...query,schema:'custodial.original-native-private-custody-write.v1'}),bytes({...query,extra:'a'}),bytes({...query,owner_proof_base64:''})])
    rejects(bytes(challenge(current(original))));
  const missing={...query};delete missing.owner_proof_base64;rejects(bytes(challenge(current(bytes(missing)))));
  for(const timestamp of ['2026-02-29T12:34:56.007Z','2026-10-14T12:34:56.007000Z']){
    const nested=JSON.parse(current());nested.original_query_timestamp=timestamp;rejects(bytes(challenge(bytes(nested))));}
});
test('DECODER_NEW canonical base64 padding bits and nested invalid UTF8 refuse',()=>{
  const valid=challenge();for(const encoded of ['',valid.current_original_query_envelope_base64+' ','Zh==','-_=='])
    rejects(bytes({...valid,current_original_query_envelope_base64:encoded}));
  const nested=JSON.parse(current());nested.original_query_body_base64='Zh==';rejects(bytes(challenge(bytes(nested))));
  rejects(bytes(challenge(Buffer.from([0xff]))));
});
test('DECODER_NEW owned Buffer intrinsic bytes ignore shadows without getter invocation',()=>{
  const body=challenge(),input=bytes(body);let calls=0;
  for(const property of ['buffer','byteOffset','byteLength','length'])Object.defineProperty(input,property,{get(){calls++;throw Error('SHADOW');}});
  assert.deepEqual(decode(input),body);assert.equal(calls,0);
});
test('DECODER_NEW shared proxy fake foreign and detached allocations refuse without traps',()=>{
  const body=bytes(challenge()),shared=Buffer.from(new SharedArrayBuffer(body.length));shared.set(body);
  Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(body.length)});assert.throws(()=>decode(shared),{code:errorCode});
  const foreign=vm.runInNewContext('new ArrayBuffer('+body.length+')');new Uint8Array(foreign).set(body);
  assert.throws(()=>decode(Buffer.from(foreign)),{code:errorCode});
  let traps=0;const proxy=new Proxy(body,{get(){traps++;throw Error('TRAP');},getPrototypeOf(){traps++;throw Error('TRAP');}});
  assert.throws(()=>decode(proxy),{code:errorCode});assert.equal(traps,0);
  assert.throws(()=>decode(Object.create(Buffer.prototype)),{code:errorCode});rejects(new Uint8Array(body));
  const backing=new ArrayBuffer(body.length),detached=Buffer.from(backing);detached.set(body);structuredClone(backing,{transfer:[backing]});
  assert.throws(()=>decode(detached),{code:errorCode});
});
test('DECODER_NEW decoder detached result and caller preservation on success and refusal',()=>{
  const input=bytes(challenge()),before=Buffer.from(input),result=decode(input);input.fill(0);
  assert.equal(result.schema,schema);assert.deepEqual(Buffer.from(result.current_original_query_envelope_base64,'base64'),current());
  const bad=Buffer.from(before);bad[10]=0xff;rejects(bad);assert.notStrictEqual(decode(before),decode(before));
});
test('DECODER_NEW new protocol above64KiB does not widen old provider parser',()=>{
  const input=Buffer.concat([bytes(challenge()),Buffer.alloc(65536,32)]);assert.ok(input.length>65536);assert.equal(decode(input).schema,schema);
});
test('DECODER_NEW exact786432 outer bound and oversize refusal',()=>{
  const input=bytes(challenge()),maximum=Buffer.concat([input,Buffer.alloc(786432-input.length,32)]);
  assert.equal(decode(maximum).schema,schema);rejects(Buffer.concat([maximum,Buffer.from(' ')]));rejects(Buffer.alloc(0));
});
test('DECODER_NEW exact Java393216 query526336 envelope bounds and size refusal',()=>{
  const original=bytes(query),maxOriginal=Buffer.concat([original,Buffer.alloc(393216-original.length,32)]);
  const nested=current(maxOriginal),maxCurrent=Buffer.concat([nested,Buffer.alloc(526336-nested.length,32)]);
  const result=decode(bytes(challenge(maxCurrent)));assert.deepEqual(Buffer.from(result.current_original_query_envelope_base64,'base64'),maxCurrent);
  rejects(bytes(challenge(Buffer.concat([maxCurrent,Buffer.from(' ')]))));
  rejects(bytes(challenge(current(Buffer.concat([maxOriginal,Buffer.from(' ')])))));
});
console.log(JSON.stringify({scope:'NODE_DECODER_WITH_SEALED_JAVA_SOURCE_VECTORS_ONLY',cases,
  Java_emitted_bytes:false,Java_execution:false,native_auth_or_intent_provenance:false,SQL:false,HTTP:false,
  manager_approval_or_effects:false,resources:{listeners:0,child_processes:0},source_vector_pins:{encoder:'31743a79',tests:'8cb99ed1'}}));
