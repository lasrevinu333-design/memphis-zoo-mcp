import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import test from 'node:test';import {createHash,createHmac} from 'node:crypto';
import * as api from '../src/native-private-custody-exchange.js';import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
// Only NEW bounded-return behavior. Fresh Java-generated synthetic originals
// and explicit read-only SQL callbacks, NOT real database/auth/HTTP/Android.
const root=process.argv[2],facts=JSON.parse(fs.readFileSync(path.join(root,'facts.json')));assert.equal(facts.synthetic_only,true);
const writes=facts.chunks.map(v=>JSON.parse(fs.readFileSync(path.join(root,'write-'+v.index+'.bin')))),queries=facts.chunks.map(v=>JSON.parse(fs.readFileSync(path.join(root,'query-'+v.index+'.bin')))),
 frame=Buffer.concat(writes.map(v=>Buffer.from(v.chunk_base64,'base64'))),sha=b=>createHash('sha256').update(b).digest('hex'),context=facts.manifest.separation_context,
 secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_RETURNED_PIECE_LOCAL_SOURCE_KEY'},
 generation={generation_id:writes[0].original_generation_id,device_id:context.device_id,device_identifier:context.canonical_device_id,credential_id:context.credential_id,employee_id:context.employee_id,
  assignment_epoch:context.assignment_epoch,principal_digest:writes[0].principal_digest,activated_at:'2026-09-24T08:00:00.123456Z'},
 device={canonical_device_pk:context.device_id,canonical_device_id:context.canonical_device_id,device_active:true,employee_active:false,employee_code:'EMP001',assigned_employee_id:context.employee_id,assignment_epoch:String(context.assignment_epoch)},
 row={credential_id:context.credential_id,device_id:context.device_id,token_hash:credentials.tokenHash(secret,env),revoked_at:null,confirmed_at:'2026-01-01T00:00:00Z',metadata_json:credentials.deviceCredentialSecretMetadata(env)},
 flags=['inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'],captures=[];
assert.equal(frame.length,Number(writes[0].frame_bytes));assert.equal(sha(frame),writes[0].frame_sha256);
async function fixture(index=0,mode='QUERY',change=null){
 const original=mode==='QUERY'?queries[index]:writes[index],p=structuredClone(original);if(change)change(p);
 const h=facts.chunks[index][mode==='QUERY'?'query_headers':'write_headers'],headers={...Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),v])),authorization:'Device '+context.credential_id+'.'+secret,
  origin:'https://localhost','x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial'},hmac=m=>createHmac('sha256',secret).update(m).digest('hex');
 if(change){p.purpose_binding_sha256=sha(Object.keys(p).filter(k=>!['purpose_binding_sha256','purpose_attestation'].includes(k)).sort().map(k=>k+'='+p[k]).join('\n'));
  p.purpose_attestation=hmac(['custodial-native-private-custody-'+mode.toLowerCase()+'.v1',context.credential_id,headers['x-memphis-native-request-id'],headers['x-memphis-native-request-timestamp'],p.purpose_binding_sha256].join('\n'));}
 const raw=Buffer.from(JSON.stringify(p));headers['x-memphis-native-request-attestation']=hmac(['custodial-native-request.v1',context.credential_id,'KIOSK_08','POST',api.privateCustodyExchangePath,sha(raw),headers['x-memphis-native-request-id'],headers['x-memphis-native-request-timestamp'],'custodial'].join('\n'));
 const request={method:'POST',originalUrl:api.privateCustodyExchangePath,scanAuthorityRawBody:raw,body:p,headers},authReads=[],fullReads=[];
 const capture=await api.captureAuthenticatedPrivateCustodyExchange(request,{env,now:new Date(headers['x-memphis-native-request-timestamp']),store:{findCredential:async()=>structuredClone(row)},runReadOnlySql:async sql=>{
  authReads.push(sql);if(sql.includes('with requested as'))return [structuredClone(device)];if(sql.includes('custodial_v13_read_separation_context'))return [{context:structuredClone(context)}];
  if(sql.includes('custodial_v14_read_separation_generation'))return [{original_generation:structuredClone(generation)}];throw new Error('unexpected synthetic auth query');}});captures.push(capture);
 const readback={schema:'custodial.private-custody-chunk-readback.v1',state:'OPAQUE_CHUNK_READ_ONLY_PENDING_RECONCILIATION',operation_id:p.operation_id,generation_id:p.original_generation_id,chunk_index:index,
  native_request_id:p.target_native_request_id??capture.native_request_id,request_body_sha256:p.target_request_body_sha256??capture.request_body_sha256,
  attestation_digest:p.target_attestation_digest??'a'.repeat(64),frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,chunk_sha256:p.chunk_sha256,chunk_bytes:Number(p.chunk_bytes),
  received_at:'2026-10-10T21:00:00.123456Z',frame_complete_syntax_verified:false,...Object.fromEntries(flags.map(k=>[k,false]))},
 value={schema:'custodial.private-custody-complete-frame-SQL-input.v1',state:'COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY',readback,frame_bytes:frame.length,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,
  plan_sha256:p.plan_sha256,chunk_count:queries.length,received_chunk_count:queries.length,frame_base64:frame.toString('base64')},
 reader=async sql=>{assert.match(sql,/^select public\.custodial_private_custody_v1_read_complete_frame\(/);assert.ok(!/retain_chunk|insert|update|delete|execute|\bgrant\b/i.test(sql));fullReads.push(sql);return [{complete_private_frame:structuredClone(value)}];};
 return {capture,p,raw,request,value,authReads,fullReads,reader,read(options={}){return api.readAuthenticatedPrivateCustodyReturnedPiece(capture,{runReadOnlySql:reader,...options});},close(){api.closeAuthenticatedPrivateCustodyExchangeCapture(capture);raw.fill(0);}};
}
test('PIECE_NEW01 all original bounded chunks preserve exact query/write witnesses and reconstruct only original encrypted frame',async()=>{
 const returned=[];for(let i=0;i<queries.length;i++){const f=await fixture(i);try{const v=await f.read();assert.equal(v.schema,'custodial.private-custody-original-frame-piece.v1');assert.equal(v.chunk_index,i);assert.equal(v.offset,i*24576);
  const b=Buffer.from(v.encrypted_piece_base64,'base64');returned.push(b);assert.equal(b.length,Number(f.p.chunk_bytes));assert.equal(sha(b),f.p.chunk_sha256);assert.ok(b.length<=24576);assert.ok(Buffer.byteLength(JSON.stringify(v))<262144);
  assert.equal(v.query_witness.native_request_id,f.capture.native_request_id);assert.equal(v.query_witness.request_body_sha256,sha(f.raw));assert.equal(v.query_witness.purpose_binding_sha256,f.p.purpose_binding_sha256);
  assert.equal(v.query_witness.target_prepared_record_sha256,f.p.target_prepared_record_sha256);assert.equal(v.query_witness.target_unknown_record_sha256,f.p.target_unknown_record_sha256);
  assert.equal(v.readback.native_request_id,f.p.attempt_id);assert.notEqual(v.readback.native_request_id,v.query_witness.native_request_id);assert.deepEqual(v.readback,f.value.readback);
  for(const k of flags)assert.equal(v[k],false);assert.equal(v.current_SQL_snapshot_frame_readback,true);assert.equal(v.original_device_key_GCM_server_verified,false);assert.equal(f.fullReads.length,1);
 }finally{f.close();}}
 try{assert.deepEqual(Buffer.concat(returned),frame);}finally{returned.forEach(b=>b.fill(0));}
});
test('PIECE_NEW02 WRITE copied closed and missing captures cannot export encrypted pieces or call SQL',async()=>{
 let calls=0;const reader=async()=>{calls++;throw new Error('forbidden');},write=await fixture(0,'WRITE'),query=await fixture();try{
  for(const c of [write.capture,structuredClone(query.capture),null])await assert.rejects(api.readAuthenticatedPrivateCustodyReturnedPiece(c,{runReadOnlySql:reader}));
  query.close();await assert.rejects(query.read({runReadOnlySql:reader}));assert.equal(calls,0);
 }finally{write.close();query.close();}
});
test('PIECE_NEW03 the same borrowed capture is one-use; ambiguous failure does not permit a second read',async()=>{
 for(const mode of ['complete','failed']){const f=await fixture();let calls=0;try{const reader=async sql=>{calls++;if(mode==='failed')throw new Error('synthetic reader unavailable');return f.reader(sql);};
  if(mode==='failed')await assert.rejects(f.read({runReadOnlySql:reader}));else await f.read({runReadOnlySql:reader});await assert.rejects(f.read({runReadOnlySql:reader}));assert.equal(calls,1);
 }finally{f.close();}}
});
test('PIECE_NEW04 absent or incomplete SQL custody never exposes a partial encrypted piece',async()=>{
 for(const value of [null,'incomplete']){const f=await fixture();try{if(value==='incomplete'){f.value.received_chunk_count=1;f.value.state='INCOMPLETE_ORIGINAL_OPAQUE_FRAME';f.value.frame_base64=null;}
  await assert.rejects(f.read(value===null?{runReadOnlySql:async()=>[{complete_private_frame:null}]}:{}),e=>e.code==='native_private_custody_returned_piece_pending');
 }finally{f.close();}}
});
test('PIECE_NEW05 original write request body and attestation are mandatory, not the query nonce or planned IDs',async()=>{
 for(const key of ['native_request_id','request_body_sha256','attestation_digest']){const f=await fixture();try{f.value.readback[key]=key==='native_request_id'?f.capture.native_request_id:'0'.repeat(64);await assert.rejects(f.read());}finally{f.close();}}
});
test('PIECE_NEW06 malformed changed and extra-field complete inputs cannot export or repair bytes',async()=>{
 for(const change of [v=>v.extra=true,v=>v.frame_base64=v.frame_base64.slice(4),v=>v.plan_sha256='0'.repeat(64),v=>v.readback.extra=true]){const f=await fixture();try{change(f.value);await assert.rejects(f.read());}finally{f.close();}}
 const f=await fixture(0,'QUERY',p=>p.chunk_sha256='0'.repeat(64));try{await assert.rejects(f.read(),e=>e.code==='native_private_custody_returned_piece_mismatch');}finally{f.close();}
});
test('PIECE_NEW07 closing the owning capture during SQL await cannot return data; diagnostics remain immutable and private',async()=>{
 const f=await fixture();try{await assert.rejects(f.read({runReadOnlySql:async sql=>{const rows=await f.reader(sql);f.close();return rows;}}));}finally{f.close();}
 const g=await fixture();try{const v=await g.read();assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.query_witness)&&Object.isFrozen(v.readback));assert.throws(()=>{v.offset=1;});
  assert.ok(!JSON.stringify(v).includes(secret));for(const k of ['frame_base64','original_signed_wire_base64','owner_proof_base64','credential_hash','credential_key_id','raw_values'])assert.equal(Object.hasOwn(v,k),false);
 }finally{g.close();}
});
test('PIECE_NEW08 refactored old complete-frame metadata contract is unchanged and never returns a piece',async()=>{
 const f=await fixture();try{const v=await api.readAuthenticatedPrivateCustodyCompleteFrame(f.capture,{runReadOnlySql:f.reader});assert.equal(v.schema,'custodial.private-custody-complete-frame-read-result.v1');
  assert.equal(v.state,'CURRENT_SQL_COMPLETE_ORIGINAL_OPAQUE_FRAME_SYNTAX_NOT_SEMANTIC_ACK');assert.deepEqual(v.readback,f.value.readback);assert.equal(v.frame_complete_syntax_verified,true);
  assert.equal(Object.hasOwn(v,'encrypted_piece_base64'),false);assert.equal(Object.hasOwn(v,'query_witness'),false);for(const k of flags)assert.equal(v[k],false);
 }finally{f.close();}
});
process.on('exit',()=>{frame.fill(0);for(const c of captures)api.closeAuthenticatedPrivateCustodyExchangeCapture(c);});
