import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createHash,createHmac} from 'node:crypto';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';
import {installSameOriginalRecoveryNativeChallengeComposition} from '../src/same-original-recovery-native-challenge-composition.js';
import {nativeOriginalInventoryRequestWire as W} from '../src/native-original-inventory-request.js';
import {nativeOriginalInventoryRegistrationWire as R} from '../src/native-original-inventory-request-route.js';
import {recoveryDeniedEffects} from '../src/same-original-recovery-wire.js';

// NEW actual loopback HTTP + shipped composition/raw receiver/auth/adapter.
// Credential/native body and SQL result are explicitly synthetic fixture DATA.
// No actual DB, native issuer, named manager, provider or effect ACK is tested.
const hash=v=>createHash('sha256').update(v).digest('hex');
function response(p){
  const b=JSON.parse(p.p_original_request_utf8),r={schema:R.schema,state:R.state,native_request_id:p.p_native_request,
    operation_id:p.p_operation,original_generation_id:p.p_generation,request_body_sha256:p.p_native_request_body_sha256,
    intent_document_sha256:b.original_intent_document_sha256,intent_disk_sha256:b.original_intent_disk_sha256,
    registered_at:p.p_native_request_timestamp.replace(/Z$/,'000Z'),limits:recoveryDeniedEffects};
  r.receipt_sha256=hash([R.digestVersion,r.native_request_id,r.operation_id,r.original_generation_id,r.request_body_sha256,
    r.intent_document_sha256,r.intent_disk_sha256,r.registered_at].join('\n'));
  return {data:JSON.stringify(r),error:null};
}
async function run(name){
  const f=inventoryRequestFixture(),app=express(),calls=[];let actual=null,ownedRaw=null;
  // This actual loopback composition owns the real current clock. Give its
  // NEW synthetic credential a matching finite horizon before first use;
  // retain the exact original intent/body and do not alter production clocks,
  // security intervals or any previously dispatched original.
  const now=Date.now();
  f.row.expires_at=new Date(now+86400000).toISOString();
  app.use((req,res,next)=>{actual=req;next();});
  const find=f.deps.store.findCredential;
  f.deps.store.findCredential=async function(...args){
    ownedRaw=Object.getOwnPropertyDescriptor(actual,'scanAuthorityRawBody')?.value??ownedRaw;
    return Reflect.apply(find,this,args);
  };
  const db={async rpc(method,p){
    calls.push({method,p});assert.equal(method,R.rpc);assert.equal(p.p_original_request_utf8,f.req.scanAuthorityRawBody.toString('utf8'));
    assert.equal(p.p_native_request_body_sha256,hash(f.req.scanAuthorityRawBody));
    if(name==='unknown')throw Error('SYNTHETIC_RPC_REPLY_LOST_AFTER_POSSIBLE_COMMIT');
    if(name==='changed')actual.headers={...actual.headers};
    return response(p);
  }};
  installSameOriginalRecoveryNativeChallengeComposition(app,{env:f.deps.env,store:f.deps.store,runReadOnlySql:f.deps.runReadOnlySql,db});
  // A genuine owning raw route must run before this normal general parser.
  app.use(express.json());
  const body=Buffer.from(f.req.scanAuthorityRawBody),headers={...f.req.headers},time=new Date(now).toISOString();
  headers['x-memphis-native-request-timestamp']=time;
  const token=headers.authorization.slice(7),credential=token.slice(0,token.indexOf('.')),secret=token.slice(token.indexOf('.')+1);
  headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',credential,
    headers['x-device-id'],'POST',W.path,hash(body),headers['x-memphis-native-request-id'],time,'custodial'].join('\n')).digest('hex');
  headers['content-type']='application/json; charset=utf-8';headers['content-length']=String(body.length);
  const server=http.createServer(app);let reply;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    reply=await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:W.path,method:'POST',headers,agent:false},res=>{
        const parts=[];res.on('data',p=>parts.push(p));res.once('error',reject);
        res.once('end',()=>resolve({status:res.statusCode,headers:res.headers,json:JSON.parse(Buffer.concat(parts).toString('utf8'))}));
      });req.setTimeout(5000,()=>req.destroy(Error('OWNED_HTTP_FIXTURE_TIMEOUT')));req.once('error',reject);req.end(body);
    });
    assert.equal(calls.length,1,'No second registration call after any result');
    assert.equal(reply.headers['cache-control'],'private, no-store');
    assert.ok(ownedRaw&&ownedRaw.every(v=>v===0),'Only owned transient request bytes wiped after terminal handoff');
    assert.equal(Object.hasOwn(actual,'scanAuthorityRawBody'),false);
    assert.deepEqual(f.req.scanAuthorityRawBody,body,'Client original DATA is preserved');
    if(name==='registered'){
      assert.equal(reply.status,200);assert.equal(reply.json.ok,true);assert.equal(reply.json.data.state,R.state);
      for(const k of Object.keys(recoveryDeniedEffects))assert.equal(reply.json.data.limits[k],false);
    }else{
      assert.ok([403,503].includes(reply.status));assert.equal(reply.json.ok,false);
      assert.equal(reply.json.outcome,'UNKNOWN');assert.equal(reply.json.retry_safe,false);
      assert.equal(Object.hasOwn(reply.json,'data'),false);
    }
    return {port,status:reply.status,rpcCalls:calls.length};
  }finally{
    await new Promise(resolve=>server.close(resolve));
    assert.equal(server.listening,false);server.closeAllConnections?.();
  }
}
const name=process.argv[2];assert.ok(['registered','unknown','changed'].includes(name),'Select one NEW HTTP member');
const result=await run(name);console.log('PASS_NEW_INVENTORY_REQUEST_ACTUAL_LOOPBACK '+name+' '+JSON.stringify(result));
console.log('PRIVATE_RPC_RECORDING_FIXTURE_ONLY; ACTUAL_SQL_NATIVE_ISSUER_MANAGER_ACK_NOT_RUN; LISTENER_CLOSED');
