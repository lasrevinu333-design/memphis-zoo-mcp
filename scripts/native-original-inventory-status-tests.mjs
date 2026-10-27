import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';
import {nativeOriginalInventoryStatusWire as W,captureAuthenticatedNativeOriginalInventoryStatus as capture,
 inspectAuthenticatedNativeOriginalInventoryStatus as inspect,closeAuthenticatedNativeOriginalInventoryStatus as close,
 decodeNativeOriginalInventoryStatus as decode} from '../src/native-original-inventory-status.js';
import {inspectAuthenticatedNativeOriginalInventoryRequest as writerInspect} from '../src/native-original-inventory-request.js';
import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
const NOW='2026-10-16T10:30:00.000Z',sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const f=inventoryRequestFixture(),old=f.req,oldBytes=Buffer.from(old.scanAuthorityRawBody);
 const body={schema:W.schema,purpose:W.purpose,original_request_utf8:oldBytes.toString('utf8'),
  original_request_timestamp:old.headers['x-memphis-native-request-timestamp'],
  original_request_attestation:old.headers['x-memphis-native-request-attestation']};
 const req={method:'POST',url:W.path,path:W.path,originalUrl:W.path,aborted:false};
 const token=credentials.credentialTokenParts(old.headers.authorization.slice(7));
 function prepare(value=body,time=NOW){
  req.scanAuthorityRawBody=Buffer.from(JSON.stringify(value));
  req.headers={...old.headers,'x-memphis-native-request-timestamp':time,
   'x-memphis-native-request-attestation':createHmac('sha256',token.secret).update([
    'custodial-native-request.v1',token.credentialId,old.headers['x-device-id'],'POST',W.path,
    sha(req.scanAuthorityRawBody),old.headers['x-memphis-native-request-id'],time,'custodial'].join('\n')).digest('hex')};
 }
 prepare();return {f,req,body,oldBytes,prepare,deps:{...f.deps,now:new Date(NOW)}};
}
const deny=action=>assert.rejects(action,e=>String(e.code).startsWith('native_original_inventory_status_'));
const cases={
 async shape(){
  const healthy=fixture(),c=await capture(healthy.req,healthy.deps);close(c);
  for(const part of ['context','original_generation']){
   const x=fixture(),read=x.deps.runReadOnlySql;
   x.deps.runReadOnlySql=async sql=>{const rows=await read(sql);if(rows[0]?.[part])rows[0][part].extra=false;return rows;};
   await deny(()=>capture(x.req,x.deps));
  }
  const future=fixture();future.f.row.confirmed_at='2026-10-16T11:00:00.000Z';
  await deny(()=>capture(future.req,future.deps));
 },
 async archived(){
  const x=fixture(),c=await capture(x.req,x.deps);
  try{
   const p=inspect(c);assert.equal(p.write_authority,false);assert.equal(p.transaction_authority,false);
   assert.equal(p.rpc_parameters.p_original_request_utf8,x.oldBytes.toString('utf8'));
   assert.equal(p.rpc_parameters.p_native_request_timestamp,x.body.original_request_timestamp);
   assert.equal(p.rpc_parameters.p_native_request_body_sha256,sha(x.oldBytes));
   assert.throws(()=>writerInspect(c));assert.throws(()=>inspect(structuredClone(c)));
   assert.deepEqual(x.f.req.scanAuthorityRawBody,x.oldBytes);
  }finally{close(c);}
  assert.throws(()=>inspect(c));assert.deepEqual(x.f.req.scanAuthorityRawBody,x.oldBytes);
 },
 async current(){
  const stale=fixture();stale.prepare(stale.body,stale.body.original_request_timestamp);
  await deny(()=>capture(stale.req,stale.deps));
  const expired=fixture();expired.f.row.expires_at='2026-10-16T10:00:00.000Z';
  await deny(()=>capture(expired.req,expired.deps));
  const changed=fixture();changed.f.setHook((kind,count)=>{if(kind==='credential'&&count===2)changed.f.row.revoked_at=NOW;});
  await deny(()=>capture(changed.req,changed.deps));
 },
 async binding(){
  for(const changed of [{original_request_attestation:'0'.repeat(64)},{original_request_timestamp:'2026-10-16T08:59:59.000Z'},
   {original_request_utf8:'{}'},{purpose:'REQUEST_EXACT_ORIGINAL_INVENTORY_ACK'}]){
   const x=fixture();x.prepare({...x.body,...changed});await deny(()=>capture(x.req,x.deps));
  }
  const x=fixture();await deny(()=>capture(x.f.req,x.deps)); // Original writer signature is not a status signature.
 },
 async terminal(){
  const x=fixture(),c=await capture(x.req,x.deps),slot=Object.getOwnPropertyDescriptor(x.req,'scanAuthorityRawBody');let calls=0;
  Object.defineProperty(x.req,'scanAuthorityRawBody',{get(){calls++;return slot.value;},configurable:true,enumerable:true});
  assert.throws(()=>inspect(c));assert.equal(calls,0);
  Object.defineProperty(x.req,'scanAuthorityRawBody',slot);assert.throws(()=>inspect(c),'restoring input must not revive capture');
  close(c);assert.deepEqual(x.f.req.scanAuthorityRawBody,x.oldBytes);
 },
 async wire(){
  const x=fixture(),raw=x.req.scanAuthorityRawBody.toString('utf8');
  assert.throws(()=>decode(Buffer.from(raw.slice(0,-1)+',"purpose":"READ_EXACT_ORIGINAL_INVENTORY_REQUEST"}')));
  assert.throws(()=>decode(Buffer.from(JSON.stringify({...x.body,extra:false}))));
  assert.throws(()=>decode(Buffer.from(new SharedArrayBuffer(20))));
  assert.throws(()=>decode(Buffer.from(JSON.stringify({...x.body,original_request_timestamp:'0000-01-01T00:00:00.000Z'}))));
 }
};
const selected=process.argv[2];assert.ok(Object.hasOwn(cases,selected),'choose one NEW status group');
await cases[selected]();console.log('PASS_NEW_CURRENT_SIGNED_STATUS_'+selected.toUpperCase()+' SYNTHETIC_AUTH_AND_READ_PORT_ONLY_NOT_SQL_NATIVE_OR_ACK');
