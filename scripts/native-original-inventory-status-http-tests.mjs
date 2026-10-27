import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createHash,createHmac} from 'node:crypto';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';
import {nativeOriginalInventoryStatusWire as W,nativeOriginalInventorySeparationApprovalStatusWire as A,
 decodeNativeOriginalInventoryStatus as decodeOld,decodeNativeOriginalInventorySeparationApprovalStatus as decodeApproval,
 captureAuthenticatedNativeOriginalInventoryStatus as captureOld,captureAuthenticatedNativeOriginalInventorySeparationApprovalStatus as captureApproval,
 inspectAuthenticatedNativeOriginalInventoryStatus as inspectOld,inspectAuthenticatedNativeOriginalInventorySeparationApprovalStatus as inspectApproval,
 closeAuthenticatedNativeOriginalInventoryStatus as closeOld,closeAuthenticatedNativeOriginalInventorySeparationApprovalStatus as closeApproval} from '../src/native-original-inventory-status.js';
import {nativeOriginalInventoryRegistrationWire as R,installNativeOriginalInventoryStatusRoute,
 installNativeOriginalInventorySeparationApprovalStatusRoute} from '../src/native-original-inventory-request-route.js';
import {inventorySeparationPurpose,inventorySeparationConfirmation} from '../src/original-inventory-separation-wire.js';
import {installSameOriginalRecoveryNativeChallengeComposition} from '../src/same-original-recovery-native-challenge-composition.js';
import {recoveryDeniedEffects} from '../src/same-original-recovery-wire.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
const APPROVAL_SQL='select public.custodial_read_native_original_inventory_separation_approval_v1(';
const OLD_SQL='select public.custodial_read_native_original_inventory_request_v1(';
const READ_NOW='2026-10-16T10:00:00.000Z';
const name=process.argv[2];
if(name?.startsWith('approval_')){await runApprovalCase(name);}else{
assert.ok(['observed','unobserved','changed'].includes(name));
const f=inventoryRequestFixture(),app=express(),reads=[];let actual,raw,writerCalls=0;
app.use((req,res,next)=>{actual=req;next();});
const original=f.req.scanAuthorityRawBody.toString('utf8'),body=JSON.parse(original),t=f.target;
const registered=f.req.headers['x-memphis-native-request-timestamp'].replace(/Z$/,'000Z');
const receipt={schema:R.schema,state:R.state,native_request_id:f.intent.intent_id,operation_id:t.operation_id,
 original_generation_id:t.original_generation_id,request_body_sha256:sha(original),
 intent_document_sha256:body.original_intent_document_sha256,intent_disk_sha256:body.original_intent_disk_sha256,
 registered_at:registered,limits:recoveryDeniedEffects};
receipt.receipt_sha256=sha([R.digestVersion,receipt.native_request_id,receipt.operation_id,receipt.original_generation_id,
 receipt.request_body_sha256,receipt.intent_document_sha256,receipt.intent_disk_sha256,registered].join('\n'));
const read=f.deps.runReadOnlySql;
const find=f.deps.store.findCredential;
f.deps.store.findCredential=async function(...args){raw=Object.getOwnPropertyDescriptor(actual,'scanAuthorityRawBody')?.value??raw;return Reflect.apply(find,this,args);};
installSameOriginalRecoveryNativeChallengeComposition(app,{env:f.deps.env,store:f.deps.store,db:{async rpc(){writerCalls++;throw Error('STATUS_MUST_NEVER_USE_WRITER');}},
 async runReadOnlySql(sql){
  if(!sql.startsWith('select public.custodial_read_native_original_inventory_request_v1('))return read(sql);
  assert.ok(sql.endsWith(') as data'));assert.ok(sql.includes("'"+original.replaceAll("'","''")+"'::text"));
  reads.push(sql);if(name==='changed')actual.headers={...actual.headers};
  return [{data:name==='unobserved'?null:JSON.stringify(receipt)}];
 }});
app.use(express.json());
const envelope={schema:W.schema,purpose:W.purpose,original_request_utf8:original,
 original_request_timestamp:f.req.headers['x-memphis-native-request-timestamp'],
 original_request_attestation:f.req.headers['x-memphis-native-request-attestation']};
const bytes=Buffer.from(JSON.stringify(envelope)),headers={...f.req.headers},time=new Date().toISOString();
const token=headers.authorization.slice(7),id=token.slice(0,token.indexOf('.')),secret=token.slice(token.indexOf('.')+1);
headers['x-memphis-native-request-timestamp']=time;
headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',id,
 headers['x-device-id'],'POST',W.path,sha(bytes),headers['x-memphis-native-request-id'],time,'custodial'].join('\n')).digest('hex');
headers['content-type']='application/json; charset=utf-8';headers['content-length']=String(bytes.length);
const server=http.createServer(app);let result;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;
 result=await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:W.path,method:'POST',headers,agent:false},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.once('error',reject);
   res.once('end',()=>resolve({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
  });req.setTimeout(5000,()=>req.destroy(Error('OWNED_STATUS_HTTP_TIMEOUT')));req.once('error',reject);req.end(bytes);
 });
 assert.equal(writerCalls,0);assert.equal(reads.length,1);assert.ok(raw&&raw.every(v=>v===0));
 assert.equal(Object.hasOwn(actual,'scanAuthorityRawBody'),false);
 assert.equal(f.req.scanAuthorityRawBody.toString('utf8'),original,'original client record not rewritten');
 if(name==='observed'){assert.equal(result.status,200);assert.equal(result.json.ok,true);assert.deepEqual(result.json.data,receipt);}
 else{assert.ok([403,503].includes(result.status));assert.equal(result.json.outcome,'UNKNOWN');assert.equal(result.json.retry_safe,false);}
 console.log('PASS_NEW_STATUS_ACTUAL_LOOPBACK '+name+' '+JSON.stringify({port,status:result.status,writerCalls,readCalls:reads.length}));
}finally{await new Promise(resolve=>server.close(resolve));server.closeAllConnections?.();assert.equal(server.listening,false);}
console.log('READ_PORT_RECORDING_FIXTURE_ONLY_NOT_ACTUAL_SQL_NATIVE_MANAGER_OR_ACK; LISTENER_CLOSED');
}

// NEW fixed approval READ path only, using the existing original/native auth
// fixture and the same owned Express/HTTP loopback facility. All credential,
// manager and SQL return rows here are SYNTHETIC recording DATA, not authority.
function signedStatus(f,wire=A,change={}){
 const original=f.req.scanAuthorityRawBody.toString('utf8');
 const envelope={schema:wire.schema,purpose:wire.purpose,original_request_utf8:original,
  original_request_timestamp:f.req.headers['x-memphis-native-request-timestamp'],
  original_request_attestation:f.req.headers['x-memphis-native-request-attestation'],...(change.envelope??{})};
 const bytes=change.bytes??Buffer.from(JSON.stringify(envelope)),headers={...f.req.headers};
 const token=headers.authorization.slice(7),at=token.indexOf('.'),id=token.slice(0,at),secret=token.slice(at+1);
 headers['x-memphis-native-request-timestamp']=change.time??READ_NOW;
 headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',id,
  headers['x-device-id'],'POST',change.signPath??wire.path,sha(bytes),headers['x-memphis-native-request-id'],
  headers['x-memphis-native-request-timestamp'],'custodial'].join('\n')).digest('hex');
 return {method:'POST',url:wire.path,originalUrl:wire.path,path:wire.path,headers,scanAuthorityRawBody:bytes,aborted:false};
}
function approvalData(f){
 const manager='90000000-0000-4000-8000-000000000001',credential='90000000-0000-4000-8000-000000000002';
 const command={schema:'custodial.original-inventory-separation-request.v1',request_id:'90000000-0000-4000-8000-000000000003',
  native_request_id:f.intent.intent_id,expected_review_sha256:'1'.repeat(64),expected_inventory_manifest_sha256:'2'.repeat(64),
  expected_registration_receipt_sha256:'3'.repeat(64),expected_separation_authority_revision:f.target.separation_authority_revision,
  expected_manager_id:manager,expected_manager_credential_id:credential,expected_manager_device_id:'synthetic_manager_device',
  decision:inventorySeparationPurpose,manager_confirmation:inventorySeparationConfirmation};
 return {schema:'custodial.original-inventory-separation-receipt.v1',state:'INVENTORY_ACK_RECORDED_LOGICAL_SEPARATION_ONLY',
  approval_id:'90000000-0000-4000-8000-000000000004',original_request:command,original_request_sha256:'4'.repeat(64),
  original_target:structuredClone(f.target),issuer:{manager_id:manager,manager_credential_id:credential,manager_device_id:'synthetic_manager_device'},
  inventory_manifest_sha256:command.expected_inventory_manifest_sha256,registration_receipt_sha256:command.expected_registration_receipt_sha256,
  approved_at:'2026-10-16T09:59:59.000000Z',expires_at:'2026-10-16T10:04:59.000000Z',receipt_sha256:'5'.repeat(64),
  limits:{...recoveryDeniedEffects,inventory_acknowledged:true,finalizer_allowed:true},
  purpose_admission_id:'exact-original-retained-inventory-separation.v1',retry_safe:false};
}
function registrationData(f){
 const original=f.req.scanAuthorityRawBody.toString('utf8'),body=JSON.parse(original),registered=f.req.headers['x-memphis-native-request-timestamp'].replace(/Z$/,'000Z');
 const r={schema:R.schema,state:R.state,native_request_id:f.intent.intent_id,operation_id:f.target.operation_id,
  original_generation_id:f.target.original_generation_id,request_body_sha256:sha(original),
  intent_document_sha256:body.original_intent_document_sha256,intent_disk_sha256:body.original_intent_disk_sha256,
  registered_at:registered,limits:recoveryDeniedEffects};
 r.receipt_sha256=sha([R.digestVersion,r.native_request_id,r.operation_id,r.original_generation_id,r.request_body_sha256,
  r.intent_document_sha256,r.intent_disk_sha256,registered].join('\n'));return r;
}
async function withApprovalHttp(options,check){
 const f=inventoryRequestFixture(),app=express(),reads=[],requests=[];
 if(options.largeOriginal){
  // Construct ONE synthetic archived original at its real 65536-byte bound.
  // This is not replacement/re-signing of a retained native original.
  const original=Buffer.alloc(65536,10);f.req.scanAuthorityRawBody.copy(original);
  f.req.scanAuthorityRawBody=original;
  const token=f.req.headers.authorization.slice(7),at=token.indexOf('.'),secret=token.slice(at+1);
  f.req.headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update([
   'custodial-native-request.v1',token.slice(0,at),f.req.headers['x-device-id'],'POST','/device-auth/original-inventory-ack',
   sha(original),f.req.headers['x-memphis-native-request-id'],f.req.headers['x-memphis-native-request-timestamp'],'custodial'].join('\n')).digest('hex');
 }
 const original=Buffer.from(f.req.scanAuthorityRawBody);
 const receipt=approvalData(f);let actual,writerCalls=0,currentRead=null;
 if(options.mainComposition){
  const now=Date.now();
  receipt.approved_at=new Date(now-1000).toISOString().replace(/Z$/,'000Z');
  receipt.expires_at=new Date(now+299000).toISOString().replace(/Z$/,'000Z');
 }
 const read=f.deps.runReadOnlySql,find=f.deps.store.findCredential;
 f.deps.store.findCredential=async function(...args){
  if(actual&&currentRead){const raw=Object.getOwnPropertyDescriptor(actual,'scanAuthorityRawBody')?.value;
   if(raw)currentRead.raw=raw;}
  return Reflect.apply(find,this,args);
 };
 app.use((req,res,next)=>{actual=req;currentRead={req,res,raw:null};requests.push(currentRead);next();});
 if(options.parserFirst)app.use(express.json());
 const deps={env:f.deps.env,store:f.deps.store,db:{async rpc(){writerCalls++;throw Error('APPROVAL_READ_MUST_NEVER_WRITE');}},
  now:()=>new Date(READ_NOW),async runReadOnlySql(sql){
   if(sql.startsWith(APPROVAL_SQL)||sql.startsWith(OLD_SQL)){
    reads.push(sql);
    const args=[...sql.matchAll(/'((?:''|[^'])*)'::([a-z0-9]+)/g)].map(m=>({value:m[1].replaceAll("''","'"),type:m[2]}));
    assert.deepEqual(args.map(x=>x.type),['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text']);
    assert.equal(args[12].value,original.toString('utf8'));assert.equal(args[8].value,f.intent.intent_id);
    assert.equal(args[9].value,f.req.headers['x-memphis-native-request-timestamp']);assert.equal(args[10].value,sha(original));
    if(options.onRead)await options.onRead({f,actual,sql,receipt,args});
    if(options.rows)return options.rows(receipt);
    return [{data:sql.startsWith(OLD_SQL)?JSON.stringify(registrationData(f)):
     options.data?options.data(structuredClone(receipt)):JSON.stringify(receipt)}];
   }
   return read(sql);
  }};
 if(options.mainComposition){
  const {now,...closed}=deps;
  installSameOriginalRecoveryNativeChallengeComposition(app,closed);
 }else installNativeOriginalInventorySeparationApprovalStatusRoute(app,deps);
 if(options.legacy)installNativeOriginalInventoryStatusRoute(app,deps);
 if(!options.parserFirst)app.use(express.json());
 const server=http.createServer(app);
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  async function invoke(change={}){
   const request=signedStatus(f,change.wire??A,options.mainComposition?{time:new Date().toISOString(),...change}:change),bytes=request.scanAuthorityRawBody;
   const headers={...request.headers,'content-type':'application/json; charset=utf-8','content-length':String(bytes.length),...(change.headers??{})};
   const response=await new Promise((resolve,reject)=>{
    const sent=http.request({host:'127.0.0.1',port,path:change.path??request.path,method:change.method??'POST',headers,agent:false},res=>{
     const parts=[];res.on('data',c=>parts.push(c));res.once('error',reject);
     res.once('end',()=>resolve({status:res.statusCode,json:JSON.parse(Buffer.concat(parts).toString('utf8'))}));
    });sent.setTimeout(5000,()=>sent.destroy(Error('OWNED_APPROVAL_READ_TIMEOUT')));sent.once('error',reject);sent.end(bytes);
   });
   assert.equal(writerCalls,0);assert.deepEqual(f.req.scanAuthorityRawBody,original);
   for(const request of requests){
    if(request.raw)assert.ok(request.raw.every(x=>x===0));
    assert.equal(Object.hasOwn(request.req,'scanAuthorityRawBody'),false);
    for(const event of ['data','end','aborted','close','error'])
     assert.equal(request.req.listeners(event).some(fn=>['onData','onEnd','onAbort','onClose'].includes(fn.name)),false);
    assert.equal(request.res.listeners('close').some(fn=>fn.name==='onResponseClose'),false);
   }
   return response;
  }
  await check({f,receipt,reads,invoke,port,requests});
 }finally{await new Promise(resolve=>server.close(resolve));server.closeAllConnections?.();assert.equal(server.listening,false);}
 assert.equal(writerCalls,0);assert.deepEqual(f.req.scanAuthorityRawBody,original);
}
async function runApprovalCase(name){
 const unknown=r=>{assert.ok([400,403,405,413,415,503].includes(r.status));assert.equal(r.json.outcome,'UNKNOWN');
  assert.equal(r.json.retry_safe,false);assert.deepEqual(r.json.limits,recoveryDeniedEffects);};
 const rejects=action=>assert.rejects(action,error=>error.code?.startsWith('native_original_inventory_'));
 const cases={
  async approval_normal_composition_mount(){
   await withApprovalHttp({mainComposition:true},async({invoke,reads,receipt})=>{
    const result=await invoke();
    assert.equal(result.status,200);
    assert.deepEqual(result.json,{ok:true,data:receipt});
    assert.equal(reads.length,1);
    assert.ok(reads[0].startsWith(APPROVAL_SQL));
   });
  },
  async approval_observed_exact_read(){
   await withApprovalHttp({},async({receipt,reads,invoke})=>{
    const r=await invoke();assert.equal(r.status,200);assert.deepEqual(r.json,{ok:true,data:receipt});
    assert.equal(reads.length,1);assert.ok(reads[0].startsWith(APPROVAL_SQL));
    assert.equal(receipt.original_request_sha256,'4'.repeat(64),'hash remains representation DATA, not serialized-command proof');
   });
  },
  async approval_closed_policy_legacy_compatibility(){
   for(const [wire,capture,inspect,close,wrongCapture,wrongInspect,wrongClose,decode,wrongDecode] of [
    [A,captureApproval,inspectApproval,closeApproval,captureOld,inspectOld,closeOld,decodeApproval,decodeOld],
    [W,captureOld,inspectOld,closeOld,captureApproval,inspectApproval,closeApproval,decodeOld,decodeApproval]]){
    const f=inventoryRequestFixture(),req=signedStatus(f,wire),original=Buffer.from(req.scanAuthorityRawBody);
    const deps={...f.deps,now:new Date(READ_NOW)};
    assert.equal(decode(req.scanAuthorityRawBody).envelope.purpose,wire.purpose);
    assert.throws(()=>wrongDecode(req.scanAuthorityRawBody));await rejects(()=>wrongCapture(req,deps));
    const cap=await capture(req,deps);
    try{
     assert.throws(()=>wrongInspect(cap),/unbound/);assert.throws(()=>wrongClose(cap),/unbound/);
     assert.equal(inspect(cap).rpc_parameters.p_original_request_utf8,f.req.scanAuthorityRawBody.toString('utf8'));
     assert.equal(inspect(cap).write_authority,false);
    }finally{close(cap);}
    assert.throws(()=>inspect(cap),/unbound/);assert.deepEqual(req.scanAuthorityRawBody,original);
   }
   await withApprovalHttp({legacy:true},async({invoke,reads})=>{
    assert.equal((await invoke({wire:W})).status,200);assert.equal((await invoke()).status,200);
    assert.ok(reads[0].startsWith(OLD_SQL));assert.ok(reads[1].startsWith(APPROVAL_SQL));
    unknown(await invoke({signPath:W.path}));assert.equal(reads.length,2,'cannot relabel fresh READ signature');
   });
  },
  async approval_changed_original_and_current_auth(){
   for(const change of [
    {envelope:{original_request_attestation:'0'.repeat(64)}},
    {envelope:{original_request_timestamp:'2026-10-16T08:59:59.999Z'}},
    {envelope:{original_request_utf8:'{}'}},{time:'2026-10-16T09:00:00.000Z'},{signPath:W.path}]){
    const f=inventoryRequestFixture(),req=signedStatus(f,A,change);await rejects(()=>captureApproval(req,{...f.deps,now:new Date(READ_NOW)}));
   }
   for(const change of [f=>f.row.confirmed_at='infinity',f=>f.row.confirmed_at='invalid',
    f=>f.row.confirmed_at='2026-10-17T00:00:00.000Z',f=>f.row.expires_at=READ_NOW,
    f=>f.row.revoked_at=READ_NOW,f=>f.generation.principal_digest='0'.repeat(64),f=>f.context.authority_revision++,
    f=>f.setHook((stage,count)=>{if(stage==='credential'&&count===2)f.row.confirmed_at='2026-10-02T00:00:00.000Z';}),
    f=>f.setHook(stage=>{if(stage==='sql')f.row.revoked_at=READ_NOW;})]){
    const f=inventoryRequestFixture();change(f);const req=signedStatus(f);await rejects(()=>captureApproval(req,{...f.deps,now:new Date(READ_NOW)}));
   }
   const f=inventoryRequestFixture(),req=signedStatus(f),cap=await captureApproval(req,{...f.deps,now:new Date(READ_NOW)});
   const original=Buffer.from(req.scanAuthorityRawBody);req.scanAuthorityRawBody[0]=33;
   assert.throws(()=>inspectApproval(cap));original.copy(req.scanAuthorityRawBody);
   assert.throws(()=>inspectApproval(cap),/unbound/,'observed source loss is sticky');
   closeApproval(cap);assert.deepEqual(req.scanAuthorityRawBody,original);
  },
  async approval_malformed_foreign_pending_results(){
   const variants=[()=>null,()=>({}),r=>r,()=>'{"schema":"duplicate","schema":"duplicate"}',
    r=>JSON.stringify({...r,state:'REGISTERED_REQUEST_ONLY_NOT_ACK'}),
    r=>JSON.stringify({...r,original_request:{...r.original_request,native_request_id:'90000000-0000-4000-8000-000000000099'}}),
    r=>JSON.stringify({...r,issuer:{...r.issuer,manager_device_id:'foreign'}}),
    r=>JSON.stringify({...r,original_request:{...r.original_request,expected_inventory_manifest_sha256:'0'.repeat(64)}}),
    r=>JSON.stringify({...r,registration_receipt_sha256:'0'.repeat(64)}),
    r=>JSON.stringify({...r,limits:{...r.limits,key_removal:true}}),r=>JSON.stringify({...r,limits:{...r.limits,inventory_acknowledged:false}}),
    r=>JSON.stringify({...r,expires_at:'infinity'}),r=>JSON.stringify({...r,retry_safe:true}),
    r=>JSON.stringify({...r,original_request_sha256:'A'.repeat(64)}),r=>JSON.stringify({...r,receipt_sha256:'0'.repeat(63)}),
    r=>JSON.stringify({...r,extra:true}),r=>JSON.stringify(r)+' false',()=> ' '.repeat(24577)];
   for(const data of variants)await withApprovalHttp({data},async({invoke,reads})=>{
    unknown(await invoke());assert.equal(reads.length,1);
   });
   const base=approvalData(inventoryRequestFixture());
   const targetUuid=new Set(['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id']);
   for(const key of Object.keys(base.original_target))await withApprovalHttp({data:r=>{
    r.original_target[key]=targetUuid.has(key)?'90000000-0000-4000-8000-000000000099':
     key==='canonical_device_id'?'KIOSK_10':key==='assignment_epoch'||key==='engine_revision'||key==='separation_authority_revision'?'99':'0'.repeat(64);
    return JSON.stringify(r);
   }},async({invoke})=>unknown(await invoke()));
   for(const rows of [()=>[],()=>[{data:null},{data:null}],()=>[{data:null,other:true}],()=>[{data:null}]])
    await withApprovalHttp({rows},async({invoke,reads})=>{unknown(await invoke());assert.equal(reads.length,1);});
  },
  async approval_withdrawal_and_pending_never_resends(){
   await withApprovalHttp({onRead:({actual})=>{actual.headers={...actual.headers};}},async({invoke,reads})=>{
    unknown(await invoke());assert.equal(reads.length,1);
   });
   await withApprovalHttp({data:()=>null},async({invoke,reads})=>{
    unknown(await invoke());unknown(await invoke());assert.equal(reads.length,2);
    assert.equal(reads[0],reads[1],'same archived READ arguments only; never a writer or replacement ID');
   });
   await withApprovalHttp({onRead:()=>{throw Error('synthetic absent SQL reader');}},async({invoke,reads})=>{
    unknown(await invoke());assert.equal(reads.length,1,'no fallback or retry after missing SQL function');
   });
  },
  async approval_stale_or_future_receipt_never_becomes_current(){
   for(const dates of [
    {approved_at:'2026-10-16T09:55:00.000000Z',expires_at:'2026-10-16T10:00:00.000000Z'},
    {approved_at:'2026-10-16T09:55:00.000000Z',expires_at:'2026-10-16T09:59:59.999999Z'},
    {approved_at:'2026-10-16T10:00:30.000001Z',expires_at:'2026-10-16T10:05:30.000001Z'}])
    await withApprovalHttp({data:r=>JSON.stringify({...r,...dates})},async({invoke,reads})=>{
     unknown(await invoke());assert.equal(reads.length,1);
    });
   await withApprovalHttp({onRead:()=>new Promise(resolve=>setTimeout(resolve,15)),
    data:r=>JSON.stringify({...r,expires_at:'2026-10-16T10:00:00.001000Z'})},async({invoke,reads})=>{
    unknown(await invoke());assert.equal(reads.length,1,'expiry across awaited READ cannot publish current approval DATA');
   });
  },
  async approval_exact_transport_and_parser_order(){
   await withApprovalHttp({},async({invoke,reads})=>{
    for(const change of [{path:A.path+'/'},{path:A.path+'?latest=true'},{path:A.path.replace('original','%6friginal')},
     {method:'GET'},{headers:{'content-type':'text/plain'}},{headers:{'content-encoding':'gzip'}},
     {headers:{'content-length':'196609'}},{envelope:{schema:W.schema}},{envelope:{purpose:W.purpose}},
     {bytes:Buffer.from('{"schema":"a","schema":"b"}')}])unknown(await invoke(change));
    assert.equal(reads.length,0);
   });
   await withApprovalHttp({parserFirst:true},async({invoke,reads})=>{
    const r=await invoke();assert.equal(r.status,400);assert.equal(r.json.code,'native_original_inventory_parser_order_invalid');
    assert.equal(reads.length,0);
   });
  },
  async approval_bounded_large_original_preserved(){
   await withApprovalHttp({largeOriginal:true},async({f,invoke,reads})=>{
    const raw=signedStatus(f).scanAuthorityRawBody;
    assert.ok(raw.length>65536&&raw.length<=A.maxRequestBytes);
    assert.equal(decodeApproval(raw).envelope.original_request_utf8,f.req.scanAuthorityRawBody.toString('utf8'));
    const r=await invoke();assert.equal(r.status,200);assert.equal(reads.length,1);
    const exact=Buffer.alloc(A.maxRequestBytes,32);raw.copy(exact);decodeApproval(exact);
    assert.throws(()=>decodeApproval(Buffer.concat([exact,Buffer.from(' ')])));
    for(const invalid of [Buffer.from('{"schema":"a","schema":"a"}'),Buffer.from('[]'),
     Buffer.from('{"schema":"\\ud800"}'),Buffer.from('{"schema":true}'),Buffer.from('{"schema":"a"} false'),
     Buffer.from([123,34,120,34,58,34,195,40,34,125])])assert.throws(()=>decodeApproval(invalid));
   });
  },
 };
 assert.ok(Object.hasOwn(cases,name),'Select exactly one NEW approval-status case');
 await cases[name]();
 console.log('PASS_NEW_APPROVAL_STATUS '+name+'; SYNTHETIC_AUTH_SQL_RECORDING_ONLY; NO_ACTUAL_SQL_MANAGER_NATIVE_ACK; OWNED_LISTENERS_CLOSED');
}
