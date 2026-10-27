import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import test from 'node:test';import {createHash,createHmac} from 'node:crypto';
import {inspectPrivateCustodyTransportFrameSyntax as inspect,observeAuthenticatedPrivateCustodyTransportFrame as observe,
 isSyntaxOnlyPrivateCustodyTransportFrame as syntax,isAuthenticatedPrivateCustodyTransportFrameObservation as branded,privateCustodyTransportFrameLimits as LIMITS} from '../src/native-private-custody-transport-frame.js';
import {isAuthenticatedPrivateCustodyOwnerObservation} from '../src/native-private-custody-owner-proof.js';
import {recordAuthenticatedNativeEvidence,retainedNativeIntakePath as PATH} from '../src/native-retained-wire-intake.js';
import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
const root=process.argv[2],facts=JSON.parse(fs.readFileSync(path.join(root,'facts.json'))),golden=fs.readFileSync(path.join(root,facts.frame_relative_path)),
 sha=b=>createHash('sha256').update(b).digest('hex'),hmac=(s,m)=>createHmac('sha256',s).update(m).digest('hex'),SCHEMA='custodial.native-private-eight-custody-transport-frame.v1',
 context=facts.context,generation=facts.original_generation,cid=context.credential_id,secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',
 env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_PRIVATE_CUSTODY_FRAME_TEST_KEY'},now=new Date('2026-10-10T17:30:00Z'),
 device={canonical_device_pk:context.device_id,canonical_device_id:context.canonical_device_id,device_active:true,employee_active:false,
  employee_code:'EMP001',assigned_employee_id:context.employee_id,assignment_epoch:String(context.assignment_epoch)},
 row={credential_id:cid,device_id:context.device_id,token_hash:credentials.tokenHash(secret,env),revoked_at:null,confirmed_at:'2026-01-01T00:00:00Z',metadata_json:credentials.deviceCredentialSecretMetadata(env)};
function fixture(mode='normal'){
 let reads=0,lookups=0;const frame=Buffer.from(golden),body={schema:'custodial.original-native-evidence-intake.v1',operation_id:'99000000-0000-4000-8000-000000000001',generation_id:generation.generation_id,signed_wire_base64:facts.original_wire_base64},
 raw=Buffer.from(JSON.stringify(body)),rid='99000000-0000-4000-8000-000000000002',headers={authorization:'Device '+cid+'.'+secret,origin:'https://localhost','x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial',
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':rid,'x-memphis-native-request-timestamp':now.toISOString()};
 headers['x-memphis-native-request-attestation']=hmac(secret,['custodial-native-request.v1',cid,'KIOSK_08','POST',PATH,sha(raw),rid,now.toISOString(),'custodial'].join('\n'));
 const req={method:'POST',originalUrl:PATH,headers,body,scanAuthorityRawBody:raw};
 const runReadOnlySql=async sql=>{reads++;
  if(sql.includes('with requested as')){if(mode==='mutate-frame'&&reads===1)frame[0]^=1;
   return [{...device}];}
  if(sql.includes('custodial_v13_'))return [{context:{...context}}];
  if(sql.includes('custodial_v14_'))return [{original_generation:{...generation}}];throw Error('Unexpected read');};
 const store={findCredential:async()=>{lookups++;return {...row,...(mode==='revoked-after'&&lookups===2?{revoked_at:now.toISOString()}:{} )};}};
 return {req,frame,options:{env,now,store,runReadOnlySql},counts:()=>({reads,lookups}),call(){return observe(this.req,this.frame,this.options);}};
}
const checksum=bytes=>{const out=Buffer.from(bytes);createHash('sha256').update(out.subarray(0,out.length-32)).digest().copy(out,out.length-32);return out;},
 denySync=bytes=>assert.throws(()=>inspect(bytes),e=>e.code==='native_private_custody_transport_frame_invalid'),
 denied=f=>assert.rejects(f.call(),e=>e.code==='native_private_custody_transport_frame_invalid'&&e.status===403),
 proofStart=12+SCHEMA.length*2,recordLengthAt=proofStart+golden.readInt32BE(8+SCHEMA.length*2),
 withProof=bytes=>{const prefix=Buffer.from(golden.subarray(0,8+SCHEMA.length*2)),size=Buffer.alloc(4);size.writeInt32BE(bytes.length);
  return checksum(Buffer.concat([prefix,size,bytes,golden.subarray(recordLengthAt,golden.length-32),Buffer.alloc(32)]));};
test('FRAME_NEW01 actual Java closed frame metadata matches exact saved frame; only syntax brand no owner or custody',()=>{
 const before=Buffer.from(golden),p=inspect(golden);assert.equal(syntax(p),true);assert.equal(branded(p),false);assert.equal(syntax(structuredClone(p)),false);
 assert.equal(p.frame_sha256,facts.frame_metadata.frame_sha256);assert.equal(p.frame_bytes,facts.frame_metadata.frame_bytes);
 assert.equal(p.record_sha256,facts.frame_metadata.record_sha256);assert.equal(p.proof_wire_sha256,facts.frame_metadata.proof_wire_sha256);
 assert.equal(p.proof_owner_HMAC_verified,false);assert.equal(p.current_normal_auth_verified,false);assert.equal(p.writer_authority,false);assert.deepEqual(golden,before);
 assert.ok(Object.isFrozen(p));
});
test('FRAME_NEW02 matching checksum and valid opaque record with malformed proof is syntax only, never normal authenticated owner',async()=>{
 const f=fixture();f.frame=withProof(Buffer.from('{'));const p=inspect(f.frame);assert.equal(p.proof_owner_HMAC_verified,false);assert.equal(p.writer_authority,false);
 await denied(f);assert.deepEqual(f.counts(),{reads:0,lookups:0});
});
test('FRAME_NEW03 wrong magic or byte order rejects even with recomputed outer checksum',()=>{
 for(const mode of ['magic','little']){const b=Buffer.from(golden);if(mode==='magic')b.writeInt32BE(0x4d5a4331,0);else b.writeInt32LE(0x4d5a5431,0);denySync(checksum(b));}
});
test('FRAME_NEW04 exact ASCII UTF16 schema rejects wrong length, changed character and null character',()=>{
 for(const mode of ['length','char','null']){const b=Buffer.from(golden);if(mode==='length')b.writeInt32BE(SCHEMA.length-1,4);else b.writeUInt16BE(mode==='null'?0:88,8);denySync(checksum(b));}
});
test('FRAME_NEW05 signed lengths and independent proof/record limits reject before allocation or auth',()=>{
 for(const [at,values]of [[8+SCHEMA.length*2,[-1,0,LIMITS.proof_bytes+1,0x7fffffff]],[recordLengthAt,[-1,0,LIMITS.record_bytes+1,0x7fffffff]]]){
  for(const n of values){const b=Buffer.from(golden);b.writeInt32BE(n,at);denySync(checksum(b));}}
});
test('FRAME_NEW06 truncation and appended rehashed bytes cannot be silently omitted',()=>{
 for(const size of [1,31,32,64,golden.length-1])denySync(golden.subarray(0,size));
 const body=Buffer.concat([golden.subarray(0,golden.length-32),Buffer.from([0]),Buffer.alloc(32)]);denySync(checksum(body));
});
test('FRAME_NEW07 changed proof or outer checksum rejects before owning auth reads',async()=>{
 for(const at of [proofStart,golden.length-1]){const f=fixture();f.frame[at]^=1;await denied(f);assert.deepEqual(f.counts(),{reads:0,lookups:0});}
});
test('FRAME_NEW08 one actual Java frame current-owner wrapper uses existing owning auth; original WORK request does NOT attest a custody frame',async()=>{
 const f=fixture(),p=await f.call();assert.equal(branded(p),true);assert.equal(syntax(p),false);assert.deepEqual(f.counts(),{reads:6,lookups:2});
 assert.equal(p.frame_sha256,facts.frame_metadata.frame_sha256);assert.equal(p.record_sha256,facts.frame_metadata.record_sha256);assert.equal(p.record_owner_HMAC_verified,true);
 assert.equal(p.original_WORK_request_identity_link_only,true);assert.equal(p.frame_request_attestation_bound,false);
 for(const k of ['durable_operation_id_bound','original_chunk_write_attempt_read_query_identities_bound','network_dispatch_allowed','writer_authority','durable_retention',
  'current_server_readback','complete_namespace_inventory','inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'])assert.equal(p[k],false);
 for(const k of [secret,'credential_hash','credential_key_id','owner_attestation','original_wire_base64','ciphertext','chunk_base64'])assert.equal(JSON.stringify(p).includes(k),false);
 assert.deepEqual(f.frame,golden);assert.ok(Object.isFrozen(p));
});
test('FRAME_NEW09 attacker rehashing changed proof purpose-HMAC still fails after original normal identity auth',async()=>{
 const f=fixture(),p=JSON.parse(golden.subarray(proofStart,recordLengthAt).toString());p.owner_attestation='0'.repeat(64);f.frame=withProof(Buffer.from(JSON.stringify(p)));
 await denied(f);assert.deepEqual(f.counts(),{reads:3,lookups:1});
});
test('FRAME_NEW10 caller frame changed while nested normal auth awaits is refused rather than hidden by inner record snapshot',async()=>{
 const f=fixture('mutate-frame');await denied(f);assert.deepEqual(f.counts(),{reads:6,lookups:2});
});
test('FRAME_NEW11 changed normal credential during frame-owner composition cannot retain stale observation',async()=>{
 const f=fixture('revoked-after');await denied(f);assert.deepEqual(f.counts(),{reads:4,lookups:2});
});
test('FRAME_NEW12 new frame observation or copied projection cannot supply old owner brand or WORK writer authority',async()=>{
 const p=await fixture().call();assert.equal(branded(structuredClone(p)),false);assert.equal(isAuthenticatedPrivateCustodyOwnerObservation(p),false);let writes=0;
 await assert.rejects(recordAuthenticatedNativeEvidence(p,{db:{rpc(){writes++;throw Error('must never write');}}}));assert.equal(writes,0);
});
test('FRAME_NEW13 shared memory, nonBuffer and over-bound input cannot create a hidden frame snapshot',()=>{
 denySync(Buffer.from(new SharedArrayBuffer(128)));denySync(new Uint8Array(golden));denySync(Buffer.alloc(LIMITS.frame_bytes+1));
});
