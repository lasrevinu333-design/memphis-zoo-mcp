import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {nativeOriginalInventoryRequestWire as W} from '../src/native-original-inventory-request.js';
import {nativeOriginalInventoryStatusWire as S} from '../src/native-original-inventory-status.js';
import {nativeOriginalInventoryRegistrationWire as R} from '../src/native-original-inventory-request-route.js';
import {installSameOriginalRecoveryNativeChallengeComposition} from '../src/same-original-recovery-native-challenge-composition.js';
import {recoveryDeniedEffects} from '../src/same-original-recovery-wire.js';
import {prepareSameOriginalNativeRegistrationFixture} from './same-original-recovery-local-database-tests.mjs';
import {deviceCredentialInternals as credentials} from '../src/auth/device-credential-auth.js';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';

// NEW actual registration/status join. Native challenge originals come from
// the existing immutable owning fixture, while this inventory intent is
// explicitly synthetic DATA: it is NOT a private native/browser capability.
// The actual shipping raw/auth routes and SQL writer/READ ONLY reader decide
// the outcome. No expected receipt or successful table row is seeded.
export async function qualifyNativeInventoryRegistrationStatusJoin({admin,target,preparationBody,preparationHeaders,confirmationGuardBaseline=null,manifestChunksOnly=false,manifestStatusOnly=false,manifestManagerSourceOnly=false,manifestSemanticReviewOnly=false,managerDecisionOnly=false,managerDecisionHttpOnly=false,managerArguments=null,managerShippingHttpRequest=null}){
 assert.equal(typeof managerDecisionHttpOnly,'boolean');
 assert.ok(managerShippingHttpRequest===null||typeof managerShippingHttpRequest==='function');
 if(managerDecisionHttpOnly)assert.ok(Array.isArray(managerArguments)&&managerArguments.length===8,'Current original manager fixture arguments required');
 const sha=v=>createHash('sha256').update(v).digest('hex');
 const secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
 const env=Object.freeze({NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'});
 const hmac=v=>createHmac('sha256',secret).update(v).digest('hex');
 const oldHeaders=Object.fromEntries(Object.entries(preparationHeaders).map(([k,v])=>[k.toLowerCase(),v]));
 const originalTime=new Date().toISOString(),intentId=randomUUID();
 const intent={schema:'custodial.native-original-inventory-ack-intent.v1',purpose:'PREPARE_EXACT_ORIGINAL_INVENTORY_ACK',
  intent_id:intentId,original_target:target,native_held_stamp:'DURABLE_HELD:8',browser_frame_sha256:sha('SYNTHETIC_BROWSER_FRAME_DATA_ONLY'),
  browser_part_set_sha256:sha('SYNTHETIC_BROWSER_PARTS_DATA_ONLY'),created_at:originalTime,...recoveryDeniedEffects};
 const originalIntent=JSON.stringify(intent),body={schema:W.schema,purpose:W.purpose,original_intent_utf8:originalIntent,
  original_intent_disk_sha256:sha('SYNTHETIC_NOT_NATIVE_ENCRYPTED_DISK'),original_intent_document_sha256:sha(originalIntent),
  original_preparation_native_request_id:oldHeaders['x-memphis-native-request-id'],
  original_preparation_request_body_sha256:sha(preparationBody),original_preparation_http_attestation:oldHeaders['x-memphis-native-request-attestation']};
 assert.match(body.original_preparation_native_request_id,/^[a-f0-9-]{36}$/);
 body.purpose_binding_sha256=sha([W.purposeVersion,body.original_intent_disk_sha256,body.original_intent_document_sha256,
  body.original_preparation_native_request_id,body.original_preparation_request_body_sha256,body.original_preparation_http_attestation].join('\n'));
 body.purpose_attestation=hmac([W.purposeVersion,target.credential_id,body.purpose_binding_sha256].join('\n'));
 const original=JSON.stringify(body),originalSha=sha(original),prepSha=sha(preparationBody);
 const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
 let server,writerCalls=0,manifestWriterCalls=0,inventoryReads=0,firstSqlFailure=null,registeredParameters;const manifestOriginals=new Map();
 const approvalReader='select public.custodial_read_native_original_inventory_separation_approval_v1(';
 let parentRpcAttempts=0,approvalReads=0,firstDecisionHttpFailure=null;const approvalReadModes=[],approvalReadFailures=[];
 const pending=new Set(),clients=new Set();
 async function role(actor,sql,values=[],readonly=true){
  assert.ok(['service_role','custodial_application_reader'].includes(actor));
  await admin.query(readonly?'begin read only':'begin');
  try{await admin.query('set local role '+actor);
   if((managerDecisionHttpOnly||managerShippingHttpRequest)&&sql.startsWith(approvalReader)){
    assert.equal(actor,'service_role');assert.equal(readonly,true);
    const mode=(await admin.query("select current_user as actor,current_setting('transaction_read_only') as mode")).rows[0];
    assert.deepEqual(mode,{actor:'service_role',mode:'on'});approvalReadModes.push(mode);
   }
   const result=await admin.query(sql,values);await admin.query('commit');return result.rows;}
  catch(error){firstSqlFailure??=error;await admin.query('rollback');throw error;}
 }
 const app=express();
 installSameOriginalRecoveryNativeChallengeComposition(app,{env,
  store:{async findCredential(id){return (await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id]))[0];}},
  async runReadOnlySql(sql){if(sql.startsWith('select public.custodial_read_native_original_inventory_request_v1('))inventoryReads++;
   if((managerDecisionHttpOnly||managerShippingHttpRequest)&&sql.startsWith(approvalReader)){
    approvalReads++;
    try{
     const args=[...sql.matchAll(/'((?:''|[^'])*)'::([a-z0-9]+)/g)].map(m=>({value:m[1].replaceAll("''","'"),kind:m[2]}));
     assert.deepEqual(args.map(x=>x.kind),kinds);
     assert.deepEqual(args.map(x=>x.value),fields.map(k=>registeredParameters[k]),'READ must use the ACTUALLY captured archived original parameters');
     return await role('service_role',sql);
    }catch(error){firstDecisionHttpFailure??=error;approvalReadFailures.push(error.code??'UNCLASSIFIED');throw error;}
   }
   return role('custodial_application_reader',sql);},
  db:{async rpc(name,parameters){if(managerDecisionHttpOnly)parentRpcAttempts++;
   if(managerShippingHttpRequest&&name==='custodial_register_original_inventory_manifest_chunk_v1'){
    assert.deepEqual(Object.keys(parameters).sort(),fields.slice().sort());
    assert.equal(manifestOriginals.has(parameters.p_native_request),false,'No second manifest writer attempt for an original');
    manifestOriginals.set(parameters.p_native_request,parameters.p_original_request_utf8);manifestWriterCalls++;
    const rows=await role('service_role','select public.'+name+'('+kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data',fields.map(k=>parameters[k]),false);
    return {data:rows[0].data,error:null};
   }
   assert.equal(name,R.rpc);assert.equal(writerCalls++,0,'one original writer dispatch only');
   assert.deepEqual(Object.keys(parameters).sort(),fields.slice().sort());registeredParameters=parameters;
   try{const rows=await role('service_role','select public.'+R.rpc+'('+kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data',fields.map(k=>parameters[k]),false);
    // The transaction commits, but its reply is deliberately LOST. This is
    // the only writer attempt; recovery must use the fixed read-only path.
    assert.equal(typeof rows[0].data,'string');
    if(manifestChunksOnly||managerDecisionHttpOnly||managerShippingHttpRequest)return {data:rows[0].data,error:null};
    throw Error('SYNTHETIC_LOST_RESPONSE_AFTER_ACTUAL_COMMIT');
   }catch(error){if(error.message!=='SYNTHETIC_LOST_RESPONSE_AFTER_ACTUAL_COMMIT')firstSqlFailure??=error;throw error;}
  }}});
 app.use(express.json());server=http.createServer(app);
 server.on('connection',socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));});
 async function request(path,text,timestamp,nativeRequestId=intentId){
  const raw=Buffer.from(text),headers={authorization:'Device '+target.credential_id+'.'+secret,origin:'https://localhost',
   'x-device-id':target.canonical_device_id,'x-memphis-app-edition':'custodial','content-type':'application/json; charset=utf-8',
   'content-length':String(raw.length),'x-memphis-native-attestation-version':'custodial-native-request.v1',
   'x-memphis-native-request-id':nativeRequestId,'x-memphis-native-request-timestamp':timestamp,
   'x-memphis-native-request-attestation':hmac(['custodial-native-request.v1',target.credential_id,target.canonical_device_id,'POST',path,sha(raw),nativeRequestId,timestamp,'custodial'].join('\n'))};
  const work=new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',headers,agent:false},res=>{
    const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>65536)req.destroy(Error('NEW_JOIN_RESPONSE_TOO_LARGE'));else chunks.push(c);});
    res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers});}
     catch(error){reject(error);}finally{for(const c of chunks)c.fill(0);}});
   });req.setTimeout(15000,()=>req.destroy(Error('NEW_JOIN_HTTP_TIMEOUT')));req.once('error',reject);req.end(raw);});
  pending.add(work);try{return await work;}finally{pending.delete(work);raw.fill(0);}
 }
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const lost=await request(W.path,original,originalTime);if(firstSqlFailure)throw firstSqlFailure;
  if(managerShippingHttpRequest){
   assert.equal(lost.status,200,'The one parent registration must return its actual SQL receipt');
   const {qualifyNativeInventoryShippingManagerHttpJoin}=await import('./native-original-inventory-shipping-manager-sql-tests.mjs');
   const result=await qualifyNativeInventoryShippingManagerHttpJoin({admin,target,originalParameters:registeredParameters,
    originalRequestHeaders:Object.freeze({...lost.headers}),parentReceipt:lost.body.data,secret,
    nativeHttpRequest:request,managerHttpRequest:managerShippingHttpRequest});
   assert.equal(writerCalls,1);assert.equal(manifestWriterCalls,result.manifest_chunks);
   return {...result,parent_registration_writer_dispatches:writerCalls,manifest_writer_dispatches:manifestWriterCalls};
  }
  if(manifestChunksOnly||managerDecisionHttpOnly){
   if(manifestSemanticReviewOnly||managerDecisionHttpOnly){
    const {qualifyNativeInventoryManifestSemanticReview}=await import('./native-original-inventory-manifest-chunk-tests.mjs');
    if(managerDecisionHttpOnly){
     assert.equal(lost.status,200,'One actual parent registration is setup, not a replay of registration proof groups');
     let result;
     try{result=await qualifyNativeInventoryManifestSemanticReview({admin,target,originalParameters:registeredParameters,env,secret,
       managerArguments,managerDecisionOnly,managerDecisionHttpOnly,
       originalRequestHeaders:Object.freeze({...lost.headers}),managerDecisionHttpRequest:request});}
     catch(error){const cause=firstDecisionHttpFailure??firstSqlFailure;
      if(cause&&cause!==error&&error&&typeof error==='object'&&error.cause===undefined)
       Object.defineProperty(error,'cause',{value:cause,configurable:true});
      throw error;
     }
     assert.equal(writerCalls,1);assert.equal(parentRpcAttempts,1,'Approval HTTP READ must never dispatch any DB writer');
     assert.equal(approvalReads,2,'One healthy decision READ and one issuing-authority withdrawal READ; changed original never reaches reader');
     assert.deepEqual(approvalReadFailures,['42501']);assert.equal(approvalReadModes.length,2);
     return {...result,parent_registration_writer_dispatches:writerCalls,parent_rpc_attempts:parentRpcAttempts,
      approval_http_sql_reads:approvalReads,approval_reader_modes:approvalReadModes,approval_reader_refusals:approvalReadFailures};
    }
    return await qualifyNativeInventoryManifestSemanticReview({admin,target,originalParameters:registeredParameters,env,secret,managerArguments,managerDecisionOnly});
   }
   if(manifestManagerSourceOnly){
    const {qualifyNativeInventoryManifestManagerSource}=await import('./native-original-inventory-manifest-chunk-tests.mjs');
    return await qualifyNativeInventoryManifestManagerSource({admin,target,originalParameters:registeredParameters,env,secret,managerArguments});
   }
   if(manifestStatusOnly){
    const {qualifyNativeInventoryManifestChunkHttpStatus}=await import('./native-original-inventory-manifest-chunk-tests.mjs');
    return await qualifyNativeInventoryManifestChunkHttpStatus({admin,target,originalParameters:registeredParameters,env,secret});
   }
   assert.equal(lost.status,200,'Parent inventory registration is fixture prerequisite only, not old proof replay');
   const {qualifyNativeInventoryManifestChunks}=await import('./native-original-inventory-manifest-chunk-tests.mjs');
   return await qualifyNativeInventoryManifestChunks({admin,target,originalParameters:registeredParameters,parentIntent:intent,env,secret});
  }
  assert.equal(lost.status,503,JSON.stringify({response:lost.body,writerCalls}));assert.equal(lost.body.outcome,'UNKNOWN');assert.equal(lost.body.retry_safe,false);assert.equal(writerCalls,1);
  const envelope=JSON.stringify({schema:S.schema,purpose:S.purpose,original_request_utf8:original,
   original_request_timestamp:originalTime,original_request_attestation:lost.headers['x-memphis-native-request-attestation']});
  const observed=await request(S.path,envelope,new Date().toISOString());if(firstSqlFailure)throw firstSqlFailure;
  assert.equal(observed.status,200,JSON.stringify(observed.body));assert.equal(observed.body.ok,true);
  const receipt=observed.body.data;assert.equal(receipt.schema,R.schema);assert.equal(receipt.state,R.state);
  assert.equal(receipt.native_request_id,intentId);assert.equal(receipt.request_body_sha256,originalSha);assert.deepEqual(receipt.limits,recoveryDeniedEffects);
  const rows=(await admin.query('select original_request_utf8,receipt_utf8 from public.custodial_native_inventory_requests where operation_id=$1',[target.operation_id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].original_request_utf8,original);assert.deepEqual(JSON.parse(rows[0].receipt_utf8),receipt);
  // A duplicate is explicitly rejected by the same intended writer role;
  // never call the HTTP sender again or treat planned IDs as retry authority.
  await admin.query('begin');try{await admin.query('set local role service_role');await assert.rejects(admin.query(
   'select public.'+R.rpc+'('+kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data',fields.map(k=>registeredParameters[k])),e=>e.code==='23505');}
  finally{await admin.query('rollback');}
  assert.equal((await admin.query('select count(*)::int n from public.custodial_native_inventory_requests where operation_id=$1',[target.operation_id])).rows[0].n,1);
  assert.equal(writerCalls,1);assert.equal(inventoryReads,1);assert.equal(sha(preparationBody),prepSha);assert.equal(sha(original),originalSha);
  let confirmation_guard=null;
  if(confirmationGuardBaseline!==null){
   assert.equal(typeof confirmationGuardBaseline,'string');
   const signature='custodial_recovery.register_native_inventory_request_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)';
   const definition=async()=>(await admin.query('select prosrc,proacl::text from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
   const currentDefinition=await definition();
   const originalCredential=(await admin.query('select row_to_json(c) row from public.device_auth_credentials c where credential_id=$1',[target.credential_id])).rows[0].row;
   const sql='select public.'+R.rpc+'('+kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data';
   const invalid=['future','infinity','-infinity'],baseline=[],fixed=[];
   async function refusal(kind,expected){
    await admin.query('savepoint confirmation_case');
    try{
     await admin.query("update public.device_auth_credentials set confirmed_at=case when $2='future' then clock_timestamp()+interval '1 hour' else $2::timestamptz end where credential_id=$1",[target.credential_id,kind]);
     await admin.query('set local role service_role');
     await assert.rejects(admin.query(sql,fields.map(k=>registeredParameters[k])),error=>error.code===expected);
     return {confirmation:kind,SQLSTATE:expected};
    }finally{await admin.query('rollback to savepoint confirmation_case');}
   }
   await admin.query('begin');
   try{
    await admin.query('savepoint historical_definition');
    await admin.query(confirmationGuardBaseline);
    for(const kind of invalid)baseline.push(await refusal(kind,'23505'));
    await admin.query('rollback to savepoint historical_definition');
    assert.deepEqual(await definition(),currentDefinition);
    for(const kind of invalid)fixed.push(await refusal(kind,'42501'));
   }finally{await admin.query('rollback');}
   assert.deepEqual(await definition(),currentDefinition);
   assert.deepEqual((await admin.query('select row_to_json(c) row from public.device_auth_credentials c where credential_id=$1',[target.credential_id])).rows[0].row,originalCredential);
   assert.equal((await admin.query('select original_request_utf8 from public.custodial_native_inventory_requests where operation_id=$1',[target.operation_id])).rows[0].original_request_utf8,original);
   confirmation_guard={baseline,fixed,healthy_current_registration_rows:1,original_credential_and_request_unchanged:true,
    baseline_limit:'Historical277 function admits invalid confirmation past current-principal gate to duplicate23505; NOT a second insert or replay authority.',
    fixture_only_transactional_function_and_credential_changes_rolled_back:true};
  }
  return {checks:['NEW actual signed raw HTTP -> intended role inventory registration commits exactly one original',
   'NEW deliberately lost writer reply remains UNKNOWN/no automatic resend','NEW fresh signed status -> actual intended READ ONLY -> exact stored original receipt',
   'NEW duplicate SQL writer refuses23505 and preserves the one original'],writer_calls:writerCalls,status_reads:inventoryReads,registration_rows:1,
   native_request_id:intentId,operation_id:target.operation_id,original_request_sha256:originalSha,receipt_sha256:receipt.receipt_sha256,
   ...(confirmation_guard?{confirmation_guard}:{}),actual_HTTP:true,actual_SQL:true,inventory_intent_source:'SYNTHETIC_DATA_NOT_NATIVE_BROWSER_ISSUER',ACK:false,finalizer:false,key_removal:false,
   genuine_manager:false,Android:false,production:false};
 }finally{
  await Promise.allSettled([...pending]);if(server.listening)await new Promise(resolve=>server.close(resolve));
  for(const socket of clients)socket.destroy();assert.equal(server.listening,false);
  if(managerDecisionHttpOnly){assert.equal(pending.size,0);assert.equal(clients.size,0,'existing fixture sockets must all close');}
 }
}

// NEW current registration status member only; the old writer floor is not
// replayed. Original absence remains UNKNOWN, never first-send authority.
export async function qualifyNativeInventoryStatusSqlFloor({admin,backendRoot}){
 const seed=await prepareSameOriginalNativeRegistrationFixture({admin,backendRoot});
 const args='uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text';
 const signature='public.custodial_read_native_original_inventory_request_v1('+args+')';
 const privateSignature='custodial_recovery.read_native_inventory_request_original('+args+')';
 const p=(await admin.query('select provolatile,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 assert.equal(p.provolatile,'s');assert.equal(p.prosecdef,true);assert.ok(p.proconfig.includes('search_path=""'));
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  assert.equal((await admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,
   role==='service_role'||role==='custodial_application_reader');
  assert.equal((await admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,privateSignature])).rows[0].allowed,false);
 }
 const f=inventoryRequestFixture(),raw=f.req.scanAuthorityRawBody,body=JSON.parse(raw),t=JSON.parse(body.original_intent_utf8).original_target;
 const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
 const values=[t.operation_id,seed.context.device_id,seed.context.credential_id,
  credentials.tokenHash('SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',env),credentials.deviceCredentialSecretKeyId(env),
  t.original_generation_id,seed.context.separation_id,String(seed.context.authority_revision),f.intent.intent_id,
  f.req.headers['x-memphis-native-request-timestamp'],createHash('sha256').update(raw).digest('hex'),'c'.repeat(64),raw.toString('utf8')];
 const sql='select public.custodial_read_native_original_inventory_request_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid,$8::text,$9::uuid,$10::timestamptz,$11::text,$12::text,$13::text) data';
 const before=(await admin.query('select count(*)::int n from public.custodial_native_inventory_requests')).rows[0].n;
 for(const role of ['service_role','custodial_application_reader']){
  await admin.query('begin read only');
  try{await admin.query('set local role '+role);assert.equal((await admin.query(sql,values)).rows[0].data,null);}
  finally{await admin.query('rollback');}
 }
 await admin.query('begin read only');
 try{await admin.query('set local role authenticated');await assert.rejects(admin.query(sql,values),e=>e.code==='42501');}
 finally{await admin.query('rollback');}
 const changed=[...values];changed[10]='0'.repeat(64);
 await admin.query('begin read only');
 try{await admin.query('set local role custodial_application_reader');await assert.rejects(admin.query(sql,changed),e=>e.code==='22023');}
 finally{await admin.query('rollback');}
 assert.equal((await admin.query('select count(*)::int n from public.custodial_native_inventory_requests')).rows[0].n,before);
 raw.fill(0);
 return {checks:['NEW fixed STABLE/private RPC ACL','NEW intended service/application reader actual READ ONLY original-absence null without insert',
  'NEW authenticated role denied','NEW changed original hash refused READ ONLY','NEW exact registration count preserved'],
  actual_SQL:true,actual_READ_ONLY:true,positive_stored_registration:'NOT_RUN',registration_rows:before,ACK:false,production:false};
}

// Only the NEW registration transaction's actual SQL/role/closed-input floor.
// The positive request fixture is DATA, not a native issuer/current manager.
// Absence must refuse before any registration; no synthetic ACK is generated.
export async function qualifyNativeInventoryRequestSqlFloor({admin,backendRoot}){
 const seed=await prepareSameOriginalNativeRegistrationFixture({admin,backendRoot});
 assert.equal(seed.context_source,'ACTUAL_FIXED_SQL_INTENDED_READER_BEFORE_NATIVE_ORIGINALS');
 const args='uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text';
 const publicSignature='public.custodial_register_native_original_inventory_request_v1('+args+')';
 const privateSignature='custodial_recovery.register_native_inventory_request_once('+args+')';
 const catalog=(await admin.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[publicSignature])).rows[0];
 assert.equal(catalog.prosecdef,true);assert.ok(catalog.proconfig.includes('search_path=""'));
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  assert.equal((await admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,publicSignature])).rows[0].allowed,role==='service_role');
  assert.equal((await admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,privateSignature])).rows[0].allowed,false);
  const direct=(await admin.query("select has_table_privilege($1,'public.custodial_native_inventory_requests','select,insert,update,delete,truncate,references,trigger') allowed",[role])).rows[0];
  assert.equal(direct.allowed,false);
 }
 const relation=(await admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.custodial_native_inventory_requests'::regclass")).rows[0];
 assert.deepEqual(relation,{relrowsecurity:true,relforcerowsecurity:true});
 const triggers=(await admin.query("select tgname,tgenabled from pg_trigger where tgrelid='public.custodial_native_inventory_requests'::regclass and not tgisinternal order by tgname")).rows;
 for(const name of ['native_inventory_request_immutable','native_inventory_request_no_truncate'])
  assert.equal(triggers.find(x=>x.tgname===name)?.tgenabled,'A');
 assert.equal(triggers.find(x=>x.tgname==='custodial_disaster_restore_mutation_fence')?.tgenabled,'O');
 const fixture=inventoryRequestFixture(),original=fixture.req.scanAuthorityRawBody,decoded=JSON.parse(original.toString('utf8')),intent=JSON.parse(decoded.original_intent_utf8),t=intent.original_target;
 const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
 const values=[t.operation_id,seed.context.device_id,seed.context.credential_id,
  credentials.tokenHash('SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',env),credentials.deviceCredentialSecretKeyId(env),
  t.original_generation_id,seed.context.separation_id,String(seed.context.authority_revision),intent.intent_id,
  new Date().toISOString(),createHash('sha256').update(original).digest('hex'),'c'.repeat(64),original.toString('utf8')];
 const sql='select public.custodial_register_native_original_inventory_request_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid,$8::text,$9::uuid,$10::timestamptz,$11::text,$12::text,$13::text) data';
 async function refusal(v,code,role='service_role'){
  await admin.query('begin');
  try{await admin.query('set local role '+role);await assert.rejects(admin.query(sql,v),error=>error.code===code);}
  finally{await admin.query('rollback');}
 }
 await refusal(values,'P0002'); // Complete closed DATA cannot create an absent original.
 await refusal(values,'42501','authenticated');
 const changed=structuredClone(decoded);changed.original_intent_document_sha256='0'.repeat(64);
 const raw=JSON.stringify(changed),bad=[...values];bad[10]=createHash('sha256').update(raw).digest('hex');bad[12]=raw;
 await refusal(bad,'42501');
 const nullIntent=structuredClone(intent);nullIntent.native_held_stamp=null;
 const changedIntent=JSON.stringify(nullIntent),nullBody={...decoded,original_intent_utf8:changedIntent,
  original_intent_document_sha256:createHash('sha256').update(changedIntent).digest('hex')};
 const rawNull=JSON.stringify(nullBody),badNull=[...values];badNull[10]=createHash('sha256').update(rawNull).digest('hex');badNull[12]=rawNull;
 await refusal(badNull,'22023');
 assert.equal((await admin.query('select count(*)::int count from public.custodial_native_inventory_requests')).rows[0].count,0);
 original.fill(0);
 return {checks:['NEW actual private/public RPC ACL + no direct table rights','NEW FORCE RLS + ALWAYS immutable guards + disaster mutation fence',
  'NEW intended service transaction refuses missing original without insert','NEW authenticated role denied','NEW altered original intent and null held stamp refused'],
  actual_SQL:true,registration_rows:0,positive_native_manager_registration:'NOT_RUN',inventory_ACK:false,production:false};
}
