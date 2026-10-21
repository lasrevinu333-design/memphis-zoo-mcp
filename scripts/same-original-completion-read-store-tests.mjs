import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

// New refusal checks use the ACTUAL Source inspector, not injected auth,
// a recording brand map or copied positive capture. Positive/await/accepted
// tuple cases require Main's genuine completion-read capture fixture.
const [backend,selector,wireSha]=process.argv.slice(2);
assert.ok(backend&&path.isAbsolute(backend));
assert.equal(selector,'COMPLETION_READ_STORE_REFUSAL_NEW');
assert.match(wireSha??'',/^[a-f0-9]{64}$/);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins={
  'src/native-private-custody-exchange.js':'d89306e6ff7ad6e9c9dbbb9c77087be097bc5138c3664e005852cdef4c8e1c6f',
  'src/native-provider-json.js':'8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294',
  'src/same-original-recovery-wire.js':'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7',
  'src/same-original-completion-read-wire.js':wireSha,
};
for(const [relative,digest] of Object.entries(pins))assert.equal(sha(fs.readFileSync(path.join(backend,relative))),digest,relative);
const ownRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const storeUrl=pathToFileURL(path.join(ownRoot,'src/same-original-completion-read-store.js')).href;
// Existing normal Node Source-test resolution facility; every relative
// product dependency resolves to its actual Main file/module instance.
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===storeUrl&&specifier.startsWith('./'))
    return next(pathToFileURL(path.join(backend,'src',specifier)).href,context);
  return next(specifier,context);
}});
let adapter;
try{adapter=await import(storeUrl);}finally{hook.deregister();}
const {recoveryDeniedEffects}=await import(pathToFileURL(path.join(backend,'src/same-original-recovery-wire.js')));
const create=adapter.createSameOriginalCompletionReadStore;
const completed=[];
function unknown(error){
  assert.equal(error.outcome,'UNKNOWN');assert.equal(error.retry_safe,false);
  assert.deepEqual(error.limits,recoveryDeniedEffects);assert.ok(Object.isFrozen(error.limits));
  assert.equal(error.cause,undefined);assert.match(error.message,/^same_original_completion_[a-z_]+$/);return true;
}
async function test(name,body){await body();completed.push(name);console.log('PASS '+name);}
let calls=0;
const db={rpc(){calls++;throw Error('UNEXPECTED_RPC_WITHOUT_PRIVATE_CAPTURE');}};
await test('COMPLETION_READ_NEW only fixed read method and db dependency',async()=>{
  assert.deepEqual(Object.keys(adapter),['createSameOriginalCompletionReadStore']);
  const store=create({db});assert.deepEqual(Object.keys(store),['readOriginalCompletionOnce']);assert.ok(Object.isFrozen(store));
  for(const dependencies of [undefined,null,{},[],{db,role:'service_role'},
    {db,inspectAuthenticatedSameOriginalCompletionRead:()=>({observation_only:true})}])assert.throws(()=>create(dependencies),unknown);
  assert.equal(calls,0);
});
await test('COMPLETION_READ_NEW copied JSON is never a capture and is consumed without RPC',async()=>{
  const copied=Object.freeze({capture:Object.freeze({}),observation_only:true,transaction_authority:false,
    original_completion_arguments_utf8:'{}',original_completion_arguments_sha256:sha('{}'),
    original_principal:Object.freeze({}),rpc_parameters:Object.freeze({})});
  const store=create({db});
  await assert.rejects(()=>store.readOriginalCompletionOnce(copied),error=>{
    unknown(error);assert.equal(error.code,'same_original_completion_capture_unbound');assert.equal(error.status,403);return true;
  });
  await assert.rejects(()=>store.readOriginalCompletionOnce(copied),error=>{
    unknown(error);assert.equal(error.code,'same_original_completion_read_already_attempted');return true;
  });
  await assert.rejects(()=>create({db}).readOriginalCompletionOnce(copied),unknown);assert.equal(calls,0);
});
await test('COMPLETION_READ_NEW proxy and accessor handles invoke no caller hooks',async()=>{
  let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error('PRIVATE_TRAP');},
    getPrototypeOf(){traps++;throw Error('PRIVATE_TRAP');},ownKeys(){traps++;throw Error('PRIVATE_TRAP');}});
  const accessor={};Object.defineProperty(accessor,'capture',{enumerable:true,get(){traps++;throw Error('PRIVATE_TRAP');}});
  for(const value of [null,undefined,1,'capture',proxy,accessor])await assert.rejects(()=>create({db}).readOriginalCompletionOnce(value),unknown);
  assert.equal(traps,0);assert.equal(calls,0);
});
await test('COMPLETION_READ_NEW unavailable or accessor RPC cannot become a readaround',async()=>{
  let traps=0;const accessor={};Object.defineProperty(accessor,'rpc',{get(){traps++;throw Error('PRIVATE_TRAP');}});
  const proxy=new Proxy(db,{get(){traps++;throw Error('PRIVATE_TRAP');},getPrototypeOf(){traps++;throw Error('PRIVATE_TRAP');}});
  const callable=new Proxy(()=>{}, {apply(){traps++;throw Error('PRIVATE_TRAP');}});
  for(const value of [null,{},accessor,proxy,{rpc:null},{rpc:callable}])assert.throws(()=>create({db:value}),unknown);
  const dependencies={};Object.defineProperty(dependencies,'db',{enumerable:true,get(){traps++;throw Error('PRIVATE_TRAP');}});
  assert.throws(()=>create(dependencies),unknown);assert.equal(traps,0);assert.equal(calls,0);
});
console.log(JSON.stringify({scope:'ACTUAL_SOURCE_INSPECTOR_REFUSAL_ONLY_NOT_POSITIVE_AUTHORITY',completed,
  genuine_capture_positive:'NOT_RUN_MISSING_MAIN_FIXTURE',accepted_tuple_reply:'NOT_RUN',lost_reply_and_closure:'NOT_RUN',
  SQL:false,HTTP:false,JVM:false,network:false,resources:{child_processes:0,listeners:0}}));
