import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import test from 'node:test';import {EventEmitter} from 'node:events';import {createHash,createHmac} from 'node:crypto';
import {installNativePrivateCustodyExchangeRoute} from '../src/native-private-custody-http-route.js';
import {privateCustodyExchangePath} from '../src/native-private-custody-exchange.js';
import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
const currentQueryOnly=process.argv.includes('--current-query-new');
// Import only the sealed owning modules, never a substituted capture/reader.
const currentRoute=currentQueryOnly?await import('../src/native-private-custody-http-route.js'):null,
 currentExchange=currentQueryOnly?await import('../src/native-private-custody-exchange.js'):null;
if(currentQueryOnly){assert.equal(typeof currentRoute.installNativePrivateCustodyCurrentQueryRoute,'function');
 assert.equal(currentExchange.privateCustodyCurrentQueryPath,'/device-auth/private-custody-current-read');}
// NEW owning route/composition checks only. Real modules and fresh original
// Java-generated synthetic requests. SQL callbacks and streams are injected:
// not actual SQL, socket/TLS, native runtime, Android or independent review.
const root=process.argv[2],facts=JSON.parse(fs.readFileSync(path.join(root,'facts.json')));assert.equal(facts.synthetic_only,true);
const oneIssuedQueryFrame=currentQueryOnly&&facts.current_query_scope==='ONE_ISSUED_QUERY_WITH_NATIVE_FRAME_SOURCE_ONLY';
const writes=facts.chunks.map(v=>JSON.parse(fs.readFileSync(path.join(root,'write-'+v.index+'.bin')))),
 queries=facts.chunks.map(v=>JSON.parse(fs.readFileSync(path.join(root,'query-'+v.index+'.bin')))),
 frame=oneIssuedQueryFrame?fs.readFileSync(path.join(root,'frame.bin')):Buffer.concat(writes.map(v=>Buffer.from(v.chunk_base64,'base64'))),sha=b=>createHash('sha256').update(b).digest('hex'),
 context=facts.manifest.separation_context,secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',
 env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'},
 generation={generation_id:writes[0].original_generation_id,device_id:context.device_id,device_identifier:context.canonical_device_id,credential_id:context.credential_id,employee_id:context.employee_id,
 assignment_epoch:context.assignment_epoch,principal_digest:writes[0].principal_digest,activated_at:'2026-09-24T08:00:00.123456Z'},
 device={canonical_device_pk:context.device_id,canonical_device_id:context.canonical_device_id,device_active:true,employee_active:false,employee_code:'EMP001',assigned_employee_id:context.employee_id,assignment_epoch:String(context.assignment_epoch)},
 row={credential_id:context.credential_id,device_id:context.device_id,token_hash:credentials.tokenHash(secret,env),revoked_at:null,confirmed_at:'2026-01-01T00:00:00Z',metadata_json:credentials.deviceCredentialSecretMetadata(env)},
 flags=['inventory_acknowledged','work_accepted','new_work_allowed','resend_allowed','finalizer_allowed','key_removal','phone_released'],MODE='bounded-original-frame-piece.v1';
assert.equal(frame.length,Number(writes[0].frame_bytes));assert.equal(sha(frame),writes[0].frame_sha256);
class Response extends EventEmitter{
 constructor(){super();this.headersSent=false;this.writableEnded=false;this.statusCode=200;this.body=null;this.endCalls=0;this.headers={};}
 setHeader(k,v){this.headers[k]=v;}
 status(v){this.statusCode=v;return this;}
 json(v){assert.equal(this.writableEnded,false);this.body=v;this.headersSent=true;this.writableEnded=true;this.emit('finish');return this;}
 end(){this.endCalls++;this.writableEnded=true;this.emit('finish');return this;}
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({index=0,mode='QUERY',reply=MODE,change=null,revoked=false,full=null,chunk=null,writer=null,wait=null,current=false,expired=false}={}){
 const p=structuredClone(mode==='QUERY'?queries[index]:writes[index]),h=facts.chunks[index][current?'current_query_headers':mode==='QUERY'?'query_headers':'write_headers'],
 headers={...Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),v])),authorization:'Device '+context.credential_id+'.'+secret,origin:'https://localhost',
 'x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial','content-type':'application/json'};
 const envelope=current?JSON.parse(fs.readFileSync(path.join(root,'current-query-'+index+'.bin'))):null;
 if(change)change(current?envelope:p,headers);
 const raw=current&&!change?fs.readFileSync(path.join(root,'current-query-'+index+'.bin')):Buffer.from(JSON.stringify(current?envelope:p)),
  hmac=m=>createHmac('sha256',secret).update(m).digest('hex');
 // Current requests use the exact Java-exported body and HMAC. Tampered
 // negatives are NEVER re-signed or mistaken for a newly admitted original.
 if(!current)headers['x-memphis-native-request-attestation']=hmac(['custodial-native-request.v1',context.credential_id,'KIOSK_08','POST',privateCustodyExchangePath,sha(raw),
 headers['x-memphis-native-request-id'],headers['x-memphis-native-request-timestamp'],'custodial'].join('\n'));
 const requestPath=current?currentExchange.privateCustodyCurrentQueryPath:privateCustodyExchangePath;
 const req=new EventEmitter();Object.assign(req,{method:'POST',originalUrl:requestPath,headers,complete:true,aborted:false});
 const res=new Response(),counts={auth:0,full:0,chunk:0,write:0},sqls=[],ownedRaw=[],entered=deferred(),release=deferred();
 const signatureDigest=sha(JSON.stringify([headers['x-memphis-native-attestation-version'],context.credential_id,'KIOSK_08','POST',privateCustodyExchangePath,
 current?sha(Buffer.from(envelope.original_query_body_base64,'base64')):sha(raw),headers['x-memphis-native-request-id'],
 current?envelope.original_query_timestamp:headers['x-memphis-native-request-timestamp'],
 current?envelope.original_query_http_attestation:headers['x-memphis-native-request-attestation']]));
 const readback={schema:'custodial.private-custody-chunk-readback.v1',state:'OPAQUE_CHUNK_READ_ONLY_PENDING_RECONCILIATION',operation_id:p.operation_id,generation_id:p.original_generation_id,chunk_index:index,
 native_request_id:p.target_native_request_id??headers['x-memphis-native-request-id'],request_body_sha256:p.target_request_body_sha256??sha(raw),
 attestation_digest:p.target_attestation_digest??signatureDigest,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,chunk_sha256:p.chunk_sha256,chunk_bytes:Number(p.chunk_bytes),
 received_at:'2026-10-11T02:00:00.123456Z',frame_complete_syntax_verified:false,...Object.fromEntries(flags.map(k=>[k,false]))};
 const value={schema:'custodial.private-custody-complete-frame-SQL-input.v1',state:'COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY',readback,
 frame_bytes:frame.length,frame_sha256:p.frame_sha256,record_sha256:p.record_sha256,plan_sha256:p.plan_sha256,
 chunk_count:current?Number(p.chunk_count):queries.length,received_chunk_count:current?Number(p.chunk_count):queries.length,frame_base64:frame.toString('base64')};
 const capabilities={env,store:{findCredential:async()=>({...structuredClone(row),revoked_at:revoked?'2026-10-11T02:00:00Z':null})},
 now:()=>new Date(Date.parse(headers['x-memphis-native-request-timestamp'])+(expired?86400000:0)),db:{rpc:async(name,args)=>{counts.write++;assert.equal(name,'custodial_private_custody_v1_retain_chunk');
 assert.equal(args.p_operation,p.operation_id);assert.equal(args.p_generation,p.original_generation_id);assert.equal(args.p_native_request,p.attempt_id);
 assert.equal(Buffer.from(args.p_request_base64,'base64').equals(raw),true);assert.equal(args.p_attestation_digest,signatureDigest);
 return writer?writer(name,args):{data:null,error:{code:'synthetic_ambiguous'}};}},
 runReadOnlySql:async sql=>{sqls.push(sql);if(sql.includes('with requested as')){counts.auth++;if(wait==='auth'){entered.resolve();await release.promise;}return [structuredClone(device)];}
 if(sql.includes('custodial_v13_read_separation_context')){counts.auth++;return [{context:structuredClone(context)}];}
 if(sql.includes('custodial_v14_read_separation_generation')){counts.auth++;return [{original_generation:structuredClone(generation)}];}
 if(/^select public\.custodial_private_custody_v1_read_complete_frame\(/.test(sql)){counts.full++;entered.resolve();if(wait)await release.promise;
 assert.ok(!/retain_chunk|insert|update|delete|\bgrant\b/i.test(sql));return full?full(value):[{complete_private_frame:structuredClone(value)}];}
 if(/^select public\.custodial_private_custody_v1_read_chunk\(/.test(sql)){counts.chunk++;return chunk?chunk(readback):[{private_custody:structuredClone(readback)}];}
 throw new Error('unexpected source fixture query');}};
 if(reply!=='LEGACY_OMITTED_TEST_ONLY')capabilities.originalQueryReply=reply;
 const registrations=[],app={post:(p,...handlers)=>registrations.push({p,handlers})};
 if(current)currentRoute.installNativePrivateCustodyCurrentQueryRoute(app,{env:capabilities.env,store:capabilities.store,
  runReadOnlySql:capabilities.runReadOnlySql,now:capabilities.now});
 else installNativePrivateCustodyExchangeRoute(app,capabilities);
 assert.equal(registrations.length,1);assert.equal(registrations[0].p,requestPath);const [parser,handle]=registrations[0].handlers;
 let running;return {p,envelope,headers,raw,req,res,counts,sqls,readback,value,capabilities,entered,release,
 start(beforeCapture){parser(req,res,()=>{ownedRaw.push(req.scanAuthorityRawBody);if(beforeCapture)beforeCapture(req);running=handle(req,res);});req.emit('data',raw);req.emit('end');req.emit('close');return running??Promise.resolve();},
 clean(){raw.fill(0);assert.equal(req.scanAuthorityRawBody,undefined);assert.equal(req.body,undefined);assert.equal(req.nativePrivateCustodyRequestState,undefined);
 assert.equal(req.listenerCount('data')+req.listenerCount('end')+req.listenerCount('aborted')+req.listenerCount('close'),0);assert.equal(res.listenerCount('close'),0);
 for(const b of ownedRaw)assert.ok(b.every(v=>v===0));}};
}
if(!currentQueryOnly){
test('HTTP_PIECE_NEW01 owning raw parser to current credential original QUERY to fixed complete reader preserves exact bounded witnesses',async()=>{
 const f=fixture();try{await f.start();assert.equal(f.res.statusCode,200);assert.equal(f.res.headers['Cache-Control'],'no-store');const v=f.res.body.data;
 assert.equal(v.schema,'custodial.private-custody-original-frame-piece.v1');assert.deepEqual(v.readback,f.readback);assert.equal(v.query_witness.native_request_id,f.p.read_query_id);
 assert.equal(v.query_witness.request_body_sha256,sha(f.raw));assert.equal(v.query_witness.target_prepared_record_sha256,f.p.target_prepared_record_sha256);
 assert.equal(v.query_witness.target_unknown_record_sha256,f.p.target_unknown_record_sha256);const b=Buffer.from(v.encrypted_piece_base64,'base64');
 try{assert.equal(b.length,Number(f.p.chunk_bytes));assert.equal(sha(b),f.p.chunk_sha256);assert.deepEqual(b,frame.subarray(0,b.length));}finally{b.fill(0);}
 assert.ok(Buffer.byteLength(JSON.stringify(f.res.body))<=262144);for(const k of flags)assert.equal(v[k],false);
 assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});
 }finally{f.clean();}
});
test('HTTP_PIECE_NEW02 closed server selector refuses unknown truthy and null modes before registration; installed reader stays pinned',async()=>{
 for(const originalQueryReply of [true,false,null,1,{},'legacy','bounded-original-frame-piece.v2']){let posts=0;assert.throws(()=>installNativePrivateCustodyExchangeRoute({post:()=>{posts++;}},{originalQueryReply}),TypeError);assert.equal(posts,0);}
 const f=fixture();f.capabilities.originalQueryReply=undefined;try{await f.start();assert.equal(f.res.body.data.schema,'custodial.private-custody-original-frame-piece.v1');assert.equal(f.counts.full,1);assert.equal(f.counts.chunk,0);}finally{f.clean();}
});
test('HTTP_PIECE_NEW03 omitted server selector retains legacy QUERY schema without promoting old query identities',async()=>{
 const f=fixture({reply:'LEGACY_OMITTED_TEST_ONLY'});try{await f.start();
 assert.equal(f.res.body.data.schema,'custodial.private-custody-read-result.v1');assert.equal(f.counts.full,0);assert.equal(f.counts.chunk,1);assert.equal(Object.hasOwn(f.res.body.data,'encrypted_piece_base64'),false);
 }finally{f.clean();}
});
test('HTTP_PIECE_NEW04 absent incomplete malformed and substituted WRITE witnesses refuse without legacy fallback writer or retry',async()=>{
 for(const full of [()=>[{complete_private_frame:null}],v=>[{complete_private_frame:{...v,state:'INCOMPLETE_ORIGINAL_OPAQUE_FRAME',received_chunk_count:1,frame_base64:null}}],
 v=>[{complete_private_frame:{...v,readback:{...v.readback,native_request_id:queries[0].read_query_id}}}],v=>[{complete_private_frame:v,extra:true}]]){
 const f=fixture({full});try{await f.start();assert.equal(f.res.statusCode,503);assert.equal(f.res.body.ok,false);assert.equal(f.res.body.state,'PENDING_REVIEW');
 assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});}finally{f.clean();}}
});
test('HTTP_PIECE_NEW05 changed purpose or revoked current credential cannot reach any private piece writer or fixed frame read',async()=>{
 for(const opts of [{change:p=>{p.purpose_binding_sha256='0'.repeat(64);}},{revoked:true}]){
 const f=fixture(opts);try{await f.start();assert.equal(f.res.statusCode,403);assert.equal(f.res.body.ok,false);assert.equal(f.counts.full+f.counts.chunk+f.counts.write,0);}finally{f.clean();}}
});
test('HTTP_PIECE_NEW06 bounded QUERY selection never changes original WRITE ambiguous one-write one-fixed-read behavior',async()=>{
 for(const available of [true,false]){const f=fixture({mode:'WRITE',chunk:available?null:()=>[{private_custody:null}]});try{await f.start();
 assert.equal(f.res.statusCode,available?200:503);assert.deepEqual(f.counts,{auth:3,full:0,chunk:1,write:1});
 if(available){assert.equal(f.res.body.data.schema,'custodial.private-custody-write-result.v1');assert.equal(f.res.body.data.ambiguous_write_reconciled,true);
 for(const k of flags)assert.equal(f.res.body.data[k],false);}else{assert.equal(f.res.body.error,'native_private_custody_write_outcome_unresolved');}
 }finally{f.clean();}}
});
test('HTTP_PIECE_NEW07 response disconnect during bounded read releases exact end hook only after awaited reader settles and emits no DTO',async()=>{
 const f=fixture({wait:true});try{const pending=f.start();await f.entered.promise;f.res.emit('close');assert.equal(f.res.endCalls,0);assert.ok(f.req.scanAuthorityRawBody);
 f.release.resolve();await pending;assert.equal(f.res.body,null);assert.equal(f.res.endCalls,1);assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});}finally{f.release.resolve();f.clean();}
});
test('HTTP_PIECE_NEW08 request abort after complete body while bounded read awaits preserves lease/body until settlement and no acceptance',async()=>{
 const f=fixture({wait:true});try{const pending=f.start();await f.entered.promise;f.req.emit('aborted');assert.equal(f.res.endCalls,0);assert.ok(f.req.scanAuthorityRawBody);
 f.release.resolve();await pending;assert.equal(f.res.body,null);assert.equal(f.res.endCalls,1);assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});}finally{f.release.resolve();f.clean();}
});
test('HTTP_PIECE_NEW09 newly selected route retains strict raw-body byte ceiling before auth and no callback range or employee-selected reader',async()=>{
 const f=fixture();try{const saved=f.raw;f.req.headers['content-type']='text/plain';await f.start();assert.equal(f.res.statusCode,415);assert.equal(Object.hasOwn(f.res.body,'data'),false);
 assert.deepEqual(f.counts,{auth:0,full:0,chunk:0,write:0});assert.ok(saved.length<=393216);}finally{f.clean();}
 const g=fixture();try{const [parser]=(()=>{const v=[];installNativePrivateCustodyExchangeRoute({post:(p,...h)=>v.push(h)},g.capabilities);return v[0];})();
 parser(g.req,g.res,()=>{throw new Error('oversize cannot reach controller');});g.req.emit('data',Buffer.alloc(393217,120));assert.equal(g.res.statusCode,413);
 assert.deepEqual(g.counts,{auth:0,full:0,chunk:0,write:0});}finally{g.clean();}
});
test('HTTP_PIECE_NEW10 explicit index source registration selects closed contract while source-only consumers and restore exemption remain required',()=>{
 const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8'),at=source.indexOf('const privateCustodyCredentialStore = createSupabaseDeviceCredentialStore(supabaseAdmin);');
 assert.ok(at>0);const section=source.slice(at,source.indexOf('// Production integrations',at));
 assert.match(section,/installNativePrivateCustodyExchangeRoute\(app,\s*\{[\s\S]*originalQueryReply: 'bounded-original-frame-piece\.v1'/);
 assert.match(section,/native_private_custody_auth_pending/);assert.equal(section.includes('supabaseAnon'),false);
 const parser=fs.readFileSync(new URL('../src/request-json-parser.js',import.meta.url),'utf8');
 assert.ok(parser.includes("if(req.method==='POST'&&req.path==='/device-auth/private-custody')return next();"));
 assert.ok(source.indexOf('app.use(makeRestoreMutationGate(')<at);assert.ok(source.includes('required: restoreGateRequired'));
});
}

if(currentQueryOnly){
 assert.equal(facts.current_query_fixture,true);
 assert.equal(facts.original_records_unchanged,true);
 assert.ok(['ONE_ISSUED_QUERY_WITH_NATIVE_FRAME_SOURCE_ONLY','ONE_FIXED_ORIGINAL_QUERY_READ','ALL_FIXED_ORIGINAL_QUERY_READS'].includes(facts.current_query_scope));
 assert.ok(Array.isArray(facts.current_query_indexes)&&facts.current_query_indexes.includes(0));
 if(oneIssuedQueryFrame){
  assert.equal(facts.actual_complete_server_write_or_SQL,false);
  assert.deepEqual(facts.current_query_indexes,[0]);assert.equal(facts.chunks.length,1);assert.equal(facts.chunks[0].index,0);
 }
 // The frame is a native TEST-source image. Supplying it to a modeled fixed
 // SQL reply does NOT establish all-chunk server retention or SQL execution.
 for(let i=0;i<facts.chunks.length;i++){
  const w=writes[i],q=queries[i],chunk=Buffer.from(w.chunk_base64,'base64');
  assert.equal(w.schema,'custodial.original-native-private-custody-write.v1');
  assert.equal(q.schema,'custodial.original-native-private-custody-query.v1');
  for(const p of [w,q]){
   assert.equal(Number(p.frame_bytes),frame.length);assert.equal(p.frame_sha256,sha(frame));
   assert.ok(Number.isSafeInteger(Number(p.chunk_count))&&Number(p.chunk_count)>0);
   assert.equal(Number(p.chunk_count),facts.plan.chunk_count);assert.equal(Number(p.chunk_index),facts.chunks[i].index);
  }
  for(const key of ['operation_id','original_generation_id','principal_digest','engine_revision','original_frozen_work_sha256',
   'record_sha256','plan_sha256','frame_sha256','frame_bytes','chunk_count','chunk_index','chunk_bytes','chunk_sha256',
   'owner_proof_base64','original_signed_wire_base64','attempt_id'])assert.equal(q[key],w[key],key+' original query/write source pin');
  assert.equal(q.target_native_request_id,w.attempt_id);
  const originalWrite=fs.readFileSync(path.join(root,'write-'+facts.chunks[i].index+'.bin'));
  try{
   assert.equal(q.target_request_body_sha256,sha(originalWrite));
   const headers=Object.fromEntries(Object.entries(facts.chunks[i].write_headers).map(([k,v])=>[k.toLowerCase(),v]));
   assert.equal(q.target_attestation_digest,sha(JSON.stringify([headers['x-memphis-native-attestation-version'],context.credential_id,
    context.canonical_device_id,'POST',privateCustodyExchangePath,sha(originalWrite),headers['x-memphis-native-request-id'],
    headers['x-memphis-native-request-timestamp'],headers['x-memphis-native-request-attestation']])));
  }finally{originalWrite.fill(0);}
  try{assert.equal(chunk.length,Number(w.chunk_bytes));assert.equal(sha(chunk),w.chunk_sha256);
   if(oneIssuedQueryFrame)assert.deepEqual(chunk,frame.subarray(0,chunk.length));
  }finally{chunk.fill(0);}
 }
 const currentFixture=options=>fixture({current:true,...options});
 const waitAtReader=async(f,pending)=>{
  await Promise.race([f.entered.promise,pending.then(()=>{throw new Error('owning source never reached the required awaited reader');})]);
 };
 test('CURRENT_QUERY_NEW01 actual Java old-day original QUERY and current outer read preserve original bounded witness, never write',async()=>{
  const f=currentFixture();
  const original=fs.readFileSync(path.join(root,'query-0.bin'));
  try{
   assert.deepEqual(Object.keys(f.envelope).sort(),['schema','original_query_body_base64','original_query_timestamp',
    'original_query_http_attestation','original_query_unknown_record_sha256'].sort());
   assert.equal(f.envelope.schema,'custodial.original-private-custody-current-query.v1');
   assert.equal(Buffer.from(f.envelope.original_query_body_base64,'base64').equals(original),true);
   const oldHeaders=Object.fromEntries(Object.entries(facts.chunks[0].query_headers).map(([k,v])=>[k.toLowerCase(),v]));
   assert.equal(f.envelope.original_query_timestamp,oldHeaders['x-memphis-native-request-timestamp']);
   assert.equal(f.envelope.original_query_http_attestation,oldHeaders['x-memphis-native-request-attestation']);
   assert.equal(f.headers['x-memphis-native-request-id'],f.p.read_query_id);
   assert.ok(Date.parse(f.headers['x-memphis-native-request-timestamp'])-Date.parse(f.envelope.original_query_timestamp)>=86400000);
   await f.start();assert.equal(f.res.statusCode,200);assert.equal(f.res.headers['Cache-Control'],'no-store');
   const v=f.res.body.data;
   assert.equal(v.schema,'custodial.private-custody-original-frame-piece.v1');
   assert.deepEqual(v.readback,f.readback);
   assert.equal(v.query_witness.native_request_id,f.p.read_query_id);
   assert.equal(v.query_witness.request_body_sha256,sha(original));
   assert.notEqual(v.query_witness.request_body_sha256,sha(f.raw));
   const expectedAttestation=sha(JSON.stringify([oldHeaders['x-memphis-native-attestation-version'],context.credential_id,
    context.canonical_device_id,'POST',privateCustodyExchangePath,sha(original),f.p.read_query_id,
    oldHeaders['x-memphis-native-request-timestamp'],oldHeaders['x-memphis-native-request-attestation']]));
   assert.equal(v.query_witness.attestation_digest,expectedAttestation);
   assert.equal(v.query_witness.purpose_binding_sha256,f.p.purpose_binding_sha256);
   assert.equal(v.query_witness.target_prepared_record_sha256,f.p.target_prepared_record_sha256);
   assert.equal(v.query_witness.target_unknown_record_sha256,f.p.target_unknown_record_sha256);
   const piece=Buffer.from(v.encrypted_piece_base64,'base64');
   try{assert.equal(piece.length,Number(f.p.chunk_bytes));assert.equal(sha(piece),f.p.chunk_sha256);
    assert.deepEqual(piece,frame.subarray(0,piece.length));}finally{piece.fill(0);}
   assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});
   for(const key of flags)assert.equal(v[key],false);
   assert.ok(Buffer.byteLength(JSON.stringify(f.res.body))<=262144);
  }finally{original.fill(0);f.clean();}
 });
 test('CURRENT_QUERY_NEW02 expired outer dispatch or revoked original credential denies current read with no fallback writer',async()=>{
  for(const options of [{expired:true},{revoked:true}]){
   const f=currentFixture(options);
   try{await f.start();assert.equal(f.res.statusCode,403);assert.equal(f.res.body.ok,false);
    assert.equal(f.counts.full+f.counts.chunk+f.counts.write,0);}finally{f.clean();}
  }
 });
 test('CURRENT_QUERY_NEW03 changed archived HTTP or purpose and actual WRITE-inside envelope fail closed without re-signing',async()=>{
  const changes=[
   e=>{e.original_query_http_attestation='0'.repeat(64);},
   e=>{const p=JSON.parse(Buffer.from(e.original_query_body_base64,'base64'));p.purpose_attestation='0'.repeat(64);
    e.original_query_body_base64=Buffer.from(JSON.stringify(p)).toString('base64');},
   e=>{e.original_query_body_base64=fs.readFileSync(path.join(root,'write-0.bin')).toString('base64');}
  ];
  // These are tampering negatives, NOT separately valid outer-HMAC proofs.
  // The archived proof owner's focused cases qualify its inner-HMAC branches.
  for(const change of changes){const f=currentFixture({change});
   try{await f.start();assert.equal(f.res.statusCode,403);assert.equal(f.res.body.ok,false);
    assert.equal(f.counts.full+f.counts.chunk+f.counts.write,0);}finally{f.clean();}
  }
 });
 test('CURRENT_QUERY_NEW04 changed original envelope, header or owned raw bytes across authentication await refuses old-body acceptance',async()=>{
  for(const change of [
   f=>{f.req.body.original_query_body_base64=Buffer.from(JSON.stringify(writes[0])).toString('base64');},
   f=>{f.req.headers['x-memphis-native-request-id']=writes[0].attempt_id;},
   f=>{f.req.scanAuthorityRawBody[0]^=1;}
  ]){
   const f=currentFixture({wait:'auth'});let pending;
   try{pending=f.start();await waitAtReader(f,pending);assert.ok(f.req.scanAuthorityRawBody);
    change(f);f.release.resolve();await pending;assert.equal(f.res.statusCode,403);
    assert.equal(f.res.body.ok,false);assert.equal(f.counts.full+f.counts.chunk+f.counts.write,0);
   }finally{f.release.resolve();if(pending)await pending;f.clean();}
  }
 });
 test('CURRENT_QUERY_NEW05 disconnect and abort retain exact current body/end lease until bounded read settles, then close without DTO',async()=>{
  for(const event of ['response-close','request-aborted']){
   const f=currentFixture({wait:true});let pending;
   try{pending=f.start();await waitAtReader(f,pending);
    if(event==='response-close')f.res.emit('close');else f.req.emit('aborted');
    assert.equal(f.res.endCalls,0);assert.equal(f.res.writableEnded,false);
    assert.equal(f.req.scanAuthorityRawBody.equals(f.raw),true);assert.ok(f.req.body);assert.ok(f.req.nativePrivateCustodyRequestState);
    f.release.resolve();await pending;
    assert.equal(f.res.body,null);assert.equal(f.res.endCalls,1);
    assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});
   }finally{f.release.resolve();if(pending)await pending;f.clean();}
  }
 });
 test('CURRENT_QUERY_NEW06 late ambiguous fixed SQL reply preserves lifetime until settlement and cannot emit a piece, fallback or acceptance',async()=>{
  const f=currentFixture({wait:true,full:()=>[]});let pending;
  try{pending=f.start();await waitAtReader(f,pending);
   assert.equal(f.res.body,null);assert.equal(f.res.writableEnded,false);assert.equal(f.res.endCalls,0);
   assert.equal(f.req.scanAuthorityRawBody.equals(f.raw),true);
   f.release.resolve();await pending;assert.equal(f.res.statusCode,503);assert.equal(f.res.body.ok,false);
   assert.equal(f.res.body.state,'PENDING_REVIEW');assert.equal(Object.hasOwn(f.res.body,'data'),false);
   assert.deepEqual(f.counts,{auth:3,full:1,chunk:0,write:0});
  }finally{f.release.resolve();if(pending)await pending;f.clean();}
 });
 test('CURRENT_QUERY_NEW07 source capture rejects shadowed shared backing before any SQL despite ordinary Buffer surface',async()=>{
  const f=currentFixture();let foreign;
  try{await f.start(req=>{
   foreign=Buffer.from(new SharedArrayBuffer(f.raw.length));f.raw.copy(foreign);
   Object.defineProperty(foreign,'buffer',{value:new ArrayBuffer(f.raw.length)});
   req.scanAuthorityRawBody=foreign;
  });assert.equal(f.res.statusCode,403);assert.equal(f.res.body.ok,false);
   assert.deepEqual(f.counts,{auth:0,full:0,chunk:0,write:0});
   // Borrowed adversarial bytes are not parser-owned. The parser must scrub
   // its original allocation, not erase a foreign substituted backing store.
   assert.equal(foreign.equals(f.raw),true);
  }finally{try{f.clean();}finally{foreign?.fill(0);}}
 });
}
process.on('exit',()=>{frame.fill(0);});
