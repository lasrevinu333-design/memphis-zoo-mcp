import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,createHmac} from 'node:crypto';
if(process.argv[2]==='--archived-query-only'){
 const {verifyArchivedOriginalPrivateQueryProof:verify}=await import('../src/native-private-custody-archived-query-proof.js');
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const mac=(key,text)=>createHmac('sha256',key).update(text,'utf8').digest('hex');
 // Synthetic keys/bytes only; no normal-auth/native/SQL fixture imports and
 // no old owner suite. Historical dates exercise structure, NOT fresh auth.
 function query(overrides={}){
  const q={credentialId:'98000000-0000-4000-8000-000000000001',
   secret:'SYNTHETIC_ARCHIVED_QUERY_SECRET_NOT_A_REAL_CREDENTIAL',canonicalDeviceId:'KIOSK_08',
   originalBody:Buffer.from('{"mode":"QUERY","opaque":"\\u0061"}\n'),
   readQueryId:'98000000-0000-4000-8000-000000000002',timestamp:'2000-02-29T12:34:56.789Z',
   purposeBindingSha256:hash('synthetic original plan/read query binding'),...overrides};
  q.httpSignature=mac(q.secret,['custodial-native-request.v1',q.credentialId,q.canonicalDeviceId,
   'POST','/device-auth/private-custody',hash(q.originalBody),q.readQueryId,q.timestamp,'custodial'].join('\n'));
  q.purposeAttestation=mac(q.secret,['custodial-native-private-custody-query.v1',q.credentialId,
   q.readQueryId,q.timestamp,q.purposeBindingSha256].join('\n'));
  return q;
 }
 const refuse=q=>assert.throws(()=>verify(q),e=>e.code==='native_private_custody_archived_query_proof_invalid'&&e.status===403);
 test('ARCHIVED01 exact original two transcripts return frozen math attestation only',()=>{
  const q=query(),before=Buffer.from(q.originalBody),p=verify(q);
  assert.deepEqual(p,{version:'custodial-native-request.v1',credential_id:q.credentialId,device_id:'KIOSK_08',
   method:'POST',path:'/device-auth/private-custody',body_sha256:hash(before),request_id:q.readQueryId,
   timestamp:q.timestamp,signature:q.httpSignature});
  assert.ok(Object.isFrozen(p));assert.deepEqual(q.originalBody,before);
  assert.equal(JSON.stringify(p).includes(q.secret),false);
  for(const key of ['accepted','current_auth','generation','witness','purpose_attestation','secret'])assert.equal(Object.hasOwn(p,key),false);
 });
 test('ARCHIVED02 body byte/whitespace/equivalent JSON mutations refuse original signatures',()=>{
  const q=query();for(const body of [Buffer.concat([q.originalBody,Buffer.from(' ')]),
   Buffer.from(JSON.stringify(JSON.parse(q.originalBody))),Buffer.from('{"mode":"WRITE"}')])refuse({...q,originalBody:body});
 });
 test('ARCHIVED03 original credential/device/request/timestamp/secret changes refuse',()=>{
  const q=query();for(const change of [{credentialId:'98000000-0000-4000-8000-000000000003'},
   {canonicalDeviceId:'KIOSK_09'},{readQueryId:'98000000-0000-4000-8000-000000000004'},
   {timestamp:'2000-02-29T12:34:56.790Z'},{secret:'SYNTHETIC_DIFFERENT_ARCHIVED_QUERY_SECRET'}])refuse({...q,...change});
 });
 test('ARCHIVED04 purpose binding and either signature cannot change independently',()=>{
  const q=query();for(const change of [{purposeBindingSha256:hash('another plan')},
   {httpSignature:'0'.repeat(64)},{purposeAttestation:'0'.repeat(64)}])refuse({...q,...change});
 });
 test('ARCHIVED05 fixed POST/path/edition and query purpose transcripts are not interchangeable',()=>{
  const q=query(),transcript=['custodial-native-request.v1',q.credentialId,q.canonicalDeviceId,'POST',
   '/device-auth/private-custody',hash(q.originalBody),q.readQueryId,q.timestamp,'custodial'];
  for(const [index,value]of [[0,'custodial-native-request.v2'],[3,'GET'],[4,'/device-auth/private-custody?x=1'],[8,'staff']]){
   const changed=[...transcript];changed[index]=value;refuse({...q,httpSignature:mac(q.secret,changed.join('\n'))});
  }
  refuse({...q,purposeAttestation:mac(q.secret,['custodial-native-private-custody-write.v1',q.credentialId,
   q.readQueryId,q.timestamp,q.purposeBindingSha256].join('\n'))});
 });
 test('ARCHIVED06 UUIDs are exact canonical version/variant, not normalized/coerced',()=>{
  const q=query();for(const key of ['credentialId','readQueryId'])for(const value of [
   '98000000-0000-4000-8000-00000000000A',' '+q[key],q[key]+'\n',
   '98000000-0000-0000-8000-000000000001','98000000-0000-4000-7000-000000000001',null,{}])refuse({...q,[key]:value});
 });
 test('ARCHIVED07 only canonical KIOSK_02 through KIOSK_10 accepted',()=>{
  for(let n=2;n<=10;n++)assert.equal(verify(query({canonicalDeviceId:'KIOSK_'+String(n).padStart(2,'0')})).device_id,
   'KIOSK_'+String(n).padStart(2,'0'));
  const q=query();for(const value of ['KIOSK_01','KIOSK_11','kiosk_08',' KIOSK_08','KIOSK_8',null])refuse({...q,canonicalDeviceId:value});
 });
 test('ARCHIVED08 exact lowercase hashes and noncoerced normal token secret required',()=>{
  const q=query();for(const key of ['httpSignature','purposeBindingSha256','purposeAttestation'])
   for(const value of [q[key].toUpperCase(),' '+q[key],q[key]+'\n','a'.repeat(63),null,{}])refuse({...q,[key]:value});
  for(const secret of ['', 'short', q.secret+'\n',Buffer.from(q.secret),{toString:()=>q.secret}])refuse({...q,secret});
 });
 test('ARCHIVED09 exact UTC milliseconds calendar rejects rollover and alternate syntax',()=>{
  for(const timestamp of ['2026-02-31T00:00:00.000Z','1900-02-29T00:00:00.000Z','2000-04-31T00:00:00.000Z',
   '2000-02-29T24:00:00.000Z','2000-02-29T12:34:60.000Z','2000-02-29T12:34:56Z',
   '2000-02-29T12:34:56.789+00:00',' 2000-02-29T12:34:56.789Z','2000-02-29T12:34:56.789Z\n'])refuse(query({timestamp}));
  const q=query();for(const value of [null,123,{toString:()=>q.timestamp}])refuse({...q,timestamp:value});
 });
 test('ARCHIVED10 historical and distant calendar dates require no clock/freshness override',()=>{
  for(const timestamp of ['0001-01-01T00:00:00.000Z','2000-02-29T00:00:00.000Z','9999-12-31T23:59:59.999Z'])
   assert.equal(verify(query({timestamp})).timestamp,timestamp);
 });
 test('ARCHIVED11 owned exact Buffer required; shared/subclass/typed/empty/oversize refused',()=>{
  const q=query(),sub=Buffer.from(q.originalBody);Object.setPrototypeOf(sub,Object.create(Buffer.prototype));
  const hiddenShared=Buffer.from(new SharedArrayBuffer(64));
  Object.defineProperty(hiddenShared,'buffer',{value:new ArrayBuffer(64)});
  const signedShared=query({originalBody:hiddenShared});refuse(signedShared);
  const hiddenOversize=Buffer.alloc(393217);Object.defineProperty(hiddenOversize,'length',{value:1});
  refuse({...q,originalBody:hiddenOversize});
  const hiddenOffset=Buffer.from(q.originalBody);Object.defineProperty(hiddenOffset,'byteOffset',{value:0});
  assert.equal(verify({...q,originalBody:hiddenOffset}).body_sha256,hash(q.originalBody));
  for(const originalBody of [new Uint8Array(q.originalBody),Buffer.from(new SharedArrayBuffer(64)),hiddenShared,sub,
   Buffer.alloc(0),Buffer.alloc(393217),null])refuse({...q,originalBody});
  assert.equal(verify(query({originalBody:Buffer.alloc(393216,1)})).body_sha256,hash(Buffer.alloc(393216,1)));
 });
 test('ARCHIVED12 invalid input produces fixed nonsecret error and no credential/body mutation',()=>{
  for(const q of [undefined,null,{},query({purposeAttestation:'unused'})]){
   if(q?.secret)q.httpSignature='0'.repeat(64);
   try{verify(q);assert.fail('must refuse');}catch(e){assert.equal(e.message,'native_private_custody_archived_query_proof_invalid');
    if(q?.secret)assert.equal(JSON.stringify(e).includes(q.secret),false);}
  }
 });
}else{
 const {observeAuthenticatedPrivateCustodyOwner:observe,isAuthenticatedPrivateCustodyOwnerObservation:branded}=await import('../src/native-private-custody-owner-proof.js');
 const {originalRetainedRecordDigestAuthority,recordAuthenticatedNativeEvidence,retainedNativeIntakePath:PATH}=await import('../src/native-retained-wire-intake.js');
 const {deviceCredentialInternals:credentials}=await import('../src/auth/device-credential-auth.js');
 const {isSyntaxOnlyPrivateCustodyRecord}=await import('../src/native-private-custody-record.js');

// NEW source composition cases on ONE actual native synthetic closed owner
// HMAC/record fixture. Current device/credential/context/generation rows are
// explicitly MODELED callbacks, not SQL/normal manager/Android/hosted proof.
const root=process.argv[2],facts=JSON.parse(fs.readFileSync(path.join(root,'facts.json'))),golden=fs.readFileSync(path.join(root,facts.record_relative_path));
const sha=b=>createHash('sha256').update(b).digest('hex'),hmac=(s,m)=>createHmac('sha256',s).update(m).digest('hex');
const context=facts.context,generation=facts.original_generation,cid=context.credential_id,secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_PRIVATE_CUSTODY_OWNER_TEST_KEY'},now=new Date('2026-10-10T17:30:00Z');
const device={canonical_device_pk:context.device_id,canonical_device_id:context.canonical_device_id,device_active:true,employee_active:false,
 employee_code:'EMP001',assigned_employee_id:context.employee_id,assignment_epoch:String(context.assignment_epoch)};
const row={credential_id:cid,device_id:context.device_id,token_hash:credentials.tokenHash(secret,env),revoked_at:null,confirmed_at:'2026-01-01T00:00:00Z',metadata_json:credentials.deviceCredentialSecretMetadata(env)};
const FIELDS=['schema','credential_id','original_wire_sha256','record_sha256','record_bytes','capsule_sha256','aad_binding_sha256','source_capture_sha256',
 'values_sha256','semantic_join_sha256','layout_sha256','principal_digest','original_generation_id','original_frozen_work_sha256','engine_revision','byte_count','record_count','chunk_count'];
function fixture(mode='normal'){
 let reads=0,lookups=0;const record=Buffer.from(golden),proof=Buffer.from(JSON.stringify(facts.proof));
 const body={schema:'custodial.original-native-evidence-intake.v1',operation_id:'98000000-0000-4000-8000-000000000001',generation_id:generation.generation_id,signed_wire_base64:facts.original_wire_base64};
 const raw=Buffer.from(JSON.stringify(body)),rid='98000000-0000-4000-8000-000000000002';
 const headers={authorization:'Device '+cid+'.'+secret,origin:'https://localhost','x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial',
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':rid,'x-memphis-native-request-timestamp':now.toISOString()};
 headers['x-memphis-native-request-attestation']=hmac(secret,['custodial-native-request.v1',cid,'KIOSK_08','POST',PATH,sha(raw),rid,now.toISOString(),'custodial'].join('\n'));
 const req={method:'POST',originalUrl:PATH,headers,body,scanAuthorityRawBody:raw};
 const runReadOnlySql=async sql=>{reads++;
  if(sql.includes('with requested as')){if(mode==='mutate-record'&&reads===1)record[0]^=1;if(mode==='mutate-proof'&&reads===1)proof[0]^=1;if(mode==='mutate-request')req.headers.origin='https://example.invalid';
   if(mode==='transient-reverted'){record[0]^=1;record[0]^=1;}
   return [{...device,...(mode==='active-employee'?{employee_active:true}:{})}];}
  if(sql.includes('custodial_v13_'))return [{context:{...context,...(mode==='context-change'&&reads>3?{authority_revision:context.authority_revision+1}:{})}}];
  if(sql.includes('custodial_v14_'))return [{original_generation:{...generation,...(mode==='wrong-generation'?{principal_digest:'0'.repeat(64)}:{}),
   ...(mode==='late-generation'?{activated_at:context.cutoff_at}:{})}}];throw Error('Unexpected read');};
 const store={findCredential:async()=>{lookups++;return {...row,...(mode==='revoked'||mode==='revoked-after'&&lookups===2?{revoked_at:now.toISOString()}:{}),
  ...(mode==='rotated-metadata'?{metadata_json:{credential_secret_key_id:'0'.repeat(64)}}:{})};}};
 return {req,record,proof,options:{env,now,store,runReadOnlySql},counts:()=>({reads,lookups}),call(){return observe(this.req,this.record,this.proof,this.options);}};
}
const denied=f=>assert.rejects(f.call(),e=>e.code==='native_private_custody_owner_proof_invalid'&&e.status===403);
const changed=(f,fn)=>{const p=structuredClone(facts.proof);fn(p);f.proof=Buffer.from(JSON.stringify(p));return f;};
test('NEW01 actual native owner HMAC + exact multichunk ciphertext uses unchanged normal auth twice; no custody/ACK/key authority',async()=>{
 const f=fixture(),p=await f.call();assert.equal(branded(p),true);assert.deepEqual(f.counts(),{reads:6,lookups:2});assert.equal(p.record_sha256,sha(golden));
 assert.equal(p.current_normal_auth_verified_at_observation,true);assert.equal(p.record_owner_HMAC_verified,true);
 for(const k of ['writer_authority','durable_retention','current_server_readback','original_device_key_GCM_verified_by_server','original_values_bytes_recovered',
  'original_frozen_work_raw_bytes_independently_verified','inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'])assert.equal(p[k],false);
 for(const k of [secret,'credential_hash','credential_key_id','owner_attestation','request_base64','original_wire_base64','ciphertext','chunk_base64'])assert.equal(JSON.stringify(p).includes(k),false);
 assert.ok(Object.isFrozen(p));assert.deepEqual(f.record,golden);
});
test('NEW02 copied JSON/syntax/old WORK brand cannot become new owner authority; new observation cannot call old writer',async()=>{
 const p=await fixture().call();assert.equal(branded(structuredClone(p)),false);assert.equal(isSyntaxOnlyPrivateCustodyRecord(p),false);
 assert.throws(()=>originalRetainedRecordDigestAuthority(p));let writes=0;
 await assert.rejects(recordAuthenticatedNativeEvidence(p,{db:{rpc(){writes++;throw Error('must never write');}}}));assert.equal(writes,0);
});
test('NEW03 closed proof schema and unknown field refuse',async()=>{
 await denied(changed(fixture(),p=>p.schema='custodial-native-protected-snapshot.v1'));await denied(changed(fixture(),p=>p.unexpected='true'));
});
test('NEW04 duplicate escaped field, BOM and trailing bytes refuse before normal reads',async()=>{
 for(const text of ['{"\\u0073chema":"duplicate",'+JSON.stringify(facts.proof).slice(1),'\ufeff'+JSON.stringify(facts.proof),JSON.stringify(facts.proof)+'{}']){
  const f=fixture();f.proof=Buffer.from(text);await denied(f);assert.deepEqual(f.counts(),{reads:0,lookups:0});}
});
test('NEW05 numeric coercion, leading zero and unsafe long refuse',async()=>{
 for(const value of ['01',1,'9007199254740992'])await denied(changed(fixture(),p=>p.engine_revision=value));
});
test('NEW06 wrong separate purpose HMAC refused after one normal original auth',async()=>{
 const f=changed(fixture(),p=>p.owner_attestation='0'.repeat(64));await denied(f);assert.deepEqual(f.counts(),{reads:3,lookups:1});
});
test('NEW07 attacker recomputing owner digest without original credential HMAC still refused',async()=>{
 const f=changed(fixture(),p=>{p.credential_id='98000000-0000-4000-8000-000000000099';p.owner_binding_sha256=sha(FIELDS.map(k=>p[k]).join('\n'));});await denied(f);assert.deepEqual(f.counts(),{reads:3,lookups:1});
});
test('NEW08 mismatched record/capsule/values/principal/original generation never use caller identity',async()=>{
 for(const k of ['record_sha256','capsule_sha256','values_sha256','principal_digest','original_generation_id'])await denied(changed(fixture(),p=>p[k]=k.endsWith('_id')?'98000000-0000-4000-8000-000000000099':'0'.repeat(64)));
});
test('NEW09 ordinary Bearer and wrong native origin/header signature refused',async()=>{
 for(const [k,v]of [['authorization','Bearer ordinary_auth'],['origin','https://example.invalid'],['x-memphis-native-request-attestation','0'.repeat(64)]]){const f=fixture();f.req.headers[k]=v;await denied(f);
  assert.deepEqual(f.counts(),k==='x-memphis-native-request-attestation'?{reads:1,lookups:1}:{reads:0,lookups:0});}
});
test('NEW10 revoked initial credential refuses',async()=>{const f=fixture('revoked');await denied(f);assert.deepEqual(f.counts(),{reads:1,lookups:1});});
test('NEW11 original employee active/current assignment is not the retired owner boundary',async()=>{const f=fixture('active-employee');await denied(f);assert.deepEqual(f.counts(),{reads:1,lookups:0});});
test('NEW12 wrong/late original generation refuses',async()=>{for(const mode of ['wrong-generation','late-generation']){const f=fixture(mode);await denied(f);assert.deepEqual(f.counts(),{reads:3,lookups:1});}});
test('NEW13 changed original credential on second owning auth refuses',async()=>{const f=fixture('revoked-after');await denied(f);assert.equal(f.counts().lookups,2);});
test('NEW14 changed normal credential secret-key metadata refuses',async()=>{const f=fixture('rotated-metadata');await denied(f);assert.deepEqual(f.counts(),{reads:1,lookups:1});});
test('NEW15 current context changes during async qualification refuses rather than accepting stale owner',async()=>{const f=fixture('context-change');await denied(f);assert.deepEqual(f.counts(),{reads:6,lookups:2});});
test('NEW16 caller changes record or proof while normal-auth awaits; owned snapshots do not hide change',async()=>{for(const mode of ['mutate-record','mutate-proof']){const f=fixture(mode);await denied(f);assert.deepEqual(f.counts(),{reads:6,lookups:2});}});
test('NEW17 request/header mutation while auth awaits refused',async()=>{const f=fixture('mutate-request');await denied(f);assert.deepEqual(f.counts(),{reads:6,lookups:2});});
test('NEW18 missing normal store/reader or copied raw request body cannot supply trusted original context',async()=>{
 const f=fixture();f.options.store=null;await denied(f);const g=fixture();g.options.runReadOnlySql=null;await denied(g);
 const h=fixture();h.req.body.operation_id='98000000-0000-4000-8000-000000000099';await denied(h);
});
test('NEW19 prior short synthetic credential is correctly rejected before store/SQL; normal policy never relaxed',async()=>{
 const f=fixture();f.req.headers.authorization='Device '+cid+'.test-device-secret-KIOSK_08';await denied(f);assert.deepEqual(f.counts(),{reads:0,lookups:0});
});
test('NEW20 explicit unchanged final bytes cannot prove transient ABA exclusion; observer remains non-writer/non-durable',async()=>{
 const f=fixture('transient-reverted'),p=await f.call();assert.equal(branded(p),true);
 assert.equal(p.all_writer_durable_freeze_or_ABA_guard,false);assert.equal(p.writer_authority,false);assert.equal(p.durable_retention,false);
 assert.equal(p.inventory_acknowledged,false);assert.deepEqual(f.counts(),{reads:6,lookups:2});
});
}
