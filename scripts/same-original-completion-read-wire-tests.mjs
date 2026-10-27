import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

// NEW purpose-specific wire checks only. Synthetic query-schema/HMAC-shaped
// strings are representation fixtures, never authenticated native/provider proof.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backend=process.argv[2]??root;
assert.ok(path.isAbsolute(backend),'absolute_backend_dependency_root_required');
const dependency=path.join(backend,'src/native-private-custody-current-query-wire.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins=[
  [dependency,'0e49384067113b3849a03bab8a075894c0782ce1ec8e13465f453c759d7123b9'],
];
for(const [file,digest] of pins)assert.equal(sha(fs.readFileSync(file)),digest);
const subjectUrl=pathToFileURL(path.join(root,'src/same-original-completion-read-wire.js')).href;
// Existing native wire-test dependency binding pattern: ONE exact relative
// production import resolves to its pinned real module; no replacement code.
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===subjectUrl&&specifier==='./native-private-custody-current-query-wire.js')
    return next(pathToFileURL(dependency).href,context);
  return next(specifier,context);
}});
let decode,wire;
try{
  ({decodeSameOriginalCompletionRead:decode,sameOriginalCompletionReadWire:wire}=await import(subjectUrl));
}finally{hook.deregister();}
const schema='custodial.same-original-completion-read.v1';
const code='same_original_completion_read_wire_invalid';
const original=Buffer.from(' \n{"schema":"custodial.original-native-private-custody-query.v1","opaque_source_fixture":"NOT_AUTHENTICATED"}\t');
function current(body=original,delta={}){
  return Buffer.from(JSON.stringify({
    schema:'custodial.original-private-custody-current-query.v1',
    original_query_body_base64:body.toString('base64'),
    original_query_timestamp:'2000-02-29T12:34:56.007Z',
    original_query_http_attestation:'a'.repeat(64),
    original_query_unknown_record_sha256:'b'.repeat(64),...delta,
  }));
}
function envelope(query=current(),args=Buffer.from([0,255,254,3,10,34,92])){
  return {schema,current_original_query_envelope_base64:query.toString('base64'),
    original_completion_arguments_base64:args.toString('base64')};
}
const bytes=body=>Buffer.from(JSON.stringify(body));
function reject(input,preserve=true){
  const before=preserve&&Buffer.isBuffer(input)?Buffer.from(input):null;
  assert.throws(()=>decode(input),error=>error?.code===code&&error.status===400
    &&error.message==='same original completion read wire invalid'&&!Object.hasOwn(error,'cause'));
  if(before)assert.deepEqual(input,before);
}
const groups=[];
function group(name,body){groups.push([name,body]);}
group('closed-contract-and-opaque-originals',()=>{
  assert.deepEqual(wire,{path:'/device-auth/private-custody-original-completion-read',schema,
    maxRequestBytes:8388608,maxOriginalQueryEnvelopeBytes:526336,maxOriginalCompletionArgumentBytes:4194304});
  assert.ok(Object.isFrozen(wire));
  const query=current(),args=Buffer.from([0,255,254,3,10,34,92]),body=envelope(query,args);
  const raw=Buffer.from(' \n'+JSON.stringify(body)+'\t '),before=Buffer.from(raw),decoded=decode(raw);
  assert.deepEqual(decoded,body);assert.ok(Object.isFrozen(decoded));assert.equal(Object.keys(decoded).length,3);
  assert.deepEqual(Buffer.from(decoded.current_original_query_envelope_base64,'base64'),query);
  assert.deepEqual(Buffer.from(decoded.original_completion_arguments_base64,'base64'),args);
  assert.deepEqual(raw,before);raw.fill(0);assert.deepEqual(decoded,body);
  // Neither JSON validity nor semantic completion fields are claimed at this layer.
  const opaque=Buffer.from('{not JSON, no manager/profile/authority}');
  assert.equal(decode(bytes(envelope(query,opaque))).original_completion_arguments_base64,opaque.toString('base64'));
  for(const key of ['authenticated','approved','retry_safe','work_accepted','inventory_acknowledged','finalizer_allowed','key_removal'])
    assert.ok(!Object.hasOwn(decoded,key));
});
group('closed-shape-and-exact-string-types',()=>{
  const good=envelope();
  for(const key of Object.keys(good)){
    const missing={...good};delete missing[key];reject(bytes(missing));
    for(const value of [null,0,false,[],{},true])reject(bytes({...good,[key]:value}));
  }
  for(const value of [null,[],true,0,'scalar'])reject(bytes(value));
  reject(bytes({...good,schema:'custodial.other.v1'}));
  reject(bytes({...good,authenticated:'false'}));
  reject(Buffer.from(JSON.stringify(good).replace('"schema":','"__proto__":"not-a-prototype","schema":')));
});
group('duplicate-escaped-keys-utf8-bom-and-json-refusal',()=>{
  const text=JSON.stringify(envelope());
  for(const raw of [
    Buffer.from('{"schema":"'+schema+'",'+text.slice(1)),
    Buffer.from('{"\\u0073chema":"'+schema+'",'+text.slice(1)),
    Buffer.from('\uFEFF'+text),Buffer.concat([Buffer.from([0xff]),Buffer.from(text)]),
    Buffer.from(text+' {}'),Buffer.from(text.slice(0,-1)+',}'),
    Buffer.from(text.replace('"schema"',"schema")),
    Buffer.from(text.replace('"schema"',"'schema'")),
    Buffer.from(text.replace(schema,'\\ud800')),
    Buffer.from(text.replace('"schema"', '"\\x73chema"')),
  ])reject(raw);
  // Legitimate escaped field names/string characters retain the exact string value.
  const escaped=text.replace('"schema"','"\\u0073chema"').replace('custodial.','custodial\\u002e');
  assert.deepEqual(decode(Buffer.from(escaped)),envelope());
});
group('canonical-base64-and-unchanged-nested-query',()=>{
  const good=envelope();
  for(const key of ['current_original_query_envelope_base64','original_completion_arguments_base64']){
    for(const bad of ['', 'Zg','Zh==','-_==','AA==\n',' AA==','AA=A','===='])
      reject(bytes({...good,[key]:bad}));
  }
  for(const query of [
    Buffer.from([0xff]),Buffer.from('{}'),Buffer.from('[]'),
    current(Buffer.from('{"schema":"foreign.v1"}')),
    current(original,{schema:'foreign.v1'}),
    current(original,{original_query_timestamp:'2000-02-30T12:34:56.007Z'}),
    current(original,{original_query_http_attestation:'A'.repeat(64)}),
    Buffer.from('{"schema":"custodial.original-private-custody-current-query.v1",'+current().toString().slice(1)),
    current(Buffer.from('{"schema":"custodial.original-native-private-custody-query.v1","schema":"custodial.original-native-private-custody-query.v1"}')),
  ])reject(bytes(envelope(query)));
});
group('intrinsic-byte-ownership-and-foreign-input-refusal',()=>{
  const body=envelope(),raw=bytes(body);
  for(const input of [null,body,new Uint8Array(raw),raw.buffer,Buffer.alloc(0),Object.create(Buffer.prototype)])
    reject(input,false);
  let traps=0;
  const proxy=new Proxy(raw,{get(){traps++;throw new Error('must_not_read');},getPrototypeOf(){traps++;throw new Error('must_not_reflect');}});
  reject(proxy,false);assert.equal(traps,0);
  let getters=0;
  const object=Object.defineProperty({},'schema',{get(){getters++;throw new Error('must_not_read');}});
  reject(object,false);
  for(const key of ['buffer','byteOffset','byteLength','length','parent','offset']){
    const shadow=bytes(body);
    Object.defineProperty(shadow,key,{get(){getters++;throw new Error('must_not_read');}});
    reject(shadow,false);
  }
  assert.equal(getters,0);
  const padded=Buffer.concat([Buffer.from('foreign-prefix'),raw,Buffer.from('foreign-tail')]);
  const view=padded.subarray(14,14+raw.length),before=Buffer.from(padded);
  assert.deepEqual(decode(view),body);assert.deepEqual(padded,before);
  const shared=new SharedArrayBuffer(raw.length);new Uint8Array(shared).set(raw);reject(Buffer.from(shared),false);
  const foreign=vm.runInNewContext('new ArrayBuffer('+raw.length+')');new Uint8Array(foreign).set(raw);
  reject(Buffer.from(foreign),false);
  const detached=new ArrayBuffer(raw.length),detachedView=Buffer.from(detached);detachedView.set(raw);
  structuredClone(detached,{transfer:[detached]});reject(detachedView,false);
  if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get){
    const growing=new ArrayBuffer(raw.length,{maxByteLength:raw.length+1});new Uint8Array(growing).set(raw);
    reject(Buffer.from(growing),false);
  }
});
group('exact-request-query-and-opaque-argument-byte-ceilings',()=>{
  const small=current(),maxQuery=Buffer.concat([small,Buffer.alloc(wire.maxOriginalQueryEnvelopeBytes-small.length,32)]);
  const argument=Buffer.alloc(wire.maxOriginalCompletionArgumentBytes,145);
  const body=envelope(maxQuery,argument),raw=bytes(body);
  assert.ok(raw.length<wire.maxRequestBytes);
  const maximum=Buffer.concat([raw,Buffer.alloc(wire.maxRequestBytes-raw.length,32)]);
  const result=decode(maximum);
  assert.equal(result.current_original_query_envelope_base64,body.current_original_query_envelope_base64);
  assert.equal(result.original_completion_arguments_base64,body.original_completion_arguments_base64);
  reject(Buffer.concat([maximum,Buffer.from(' ')]),false);
  reject(bytes(envelope(Buffer.concat([maxQuery,Buffer.from(' ')]))),false);
  reject(bytes(envelope(current(),Buffer.alloc(wire.maxOriginalCompletionArgumentBytes+1,145))),false);
});
group('owned-temporary-wiping-success-and-failure',()=>{
  const good=bytes(envelope()),before=Buffer.from(good),fill=Buffer.prototype.fill,owned=[];
  try{
    Buffer.prototype.fill=function(value,...rest){if(value===0)owned.push(this);return Reflect.apply(fill,this,[value,...rest]);};
    decode(good);
    assert.ok(owned.length>=5); // new raw/current/opaque + actual nested request/original copies
    for(const value of owned)assert.ok(value.every(byte=>byte===0));
    assert.deepEqual(good,before);owned.length=0;
    reject(bytes(envelope(Buffer.from('not query JSON'))));
    assert.ok(owned.length>=3);for(const value of owned)assert.ok(value.every(byte=>byte===0));
  }finally{Buffer.prototype.fill=fill;}
  assert.deepEqual(good,before);
});
const selected=process.argv[3];
assert.ok(!selected||groups.some(([name])=>name===selected),'unknown_new_completion_read_wire_member');
let count=0;
for(const [name,body] of groups){
  if(selected&&selected!==name)continue;
  try{body();console.log('PASS_NEW_SAME_ORIGINAL_COMPLETION_READ_WIRE '+name);count++;}
  catch(error){console.error('FAIL_NEW_SAME_ORIGINAL_COMPLETION_READ_WIRE '+name+' '+(error.code??error.name));throw error;}
}
for(const [file,digest] of pins)assert.equal(sha(fs.readFileSync(file)),digest);
console.log('NEW_GROUPS='+count+' OLD_GROUPS=0 REPRESENTATION_ONLY_NO_AUTH_SQL_HTTP_OR_NATIVE_AUTHORITY');

