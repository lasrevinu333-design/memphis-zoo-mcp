import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import express from 'express';
import {installSameOriginalRecoveryNativeChallengeComposition} from '../src/same-original-recovery-native-challenge-composition.js';
import {nativeOriginalInventoryManifestChunkWire as W,decodeNativeOriginalInventoryManifestChunk as decode,
 captureAuthenticatedNativeOriginalInventoryManifestChunk as capture,inspectAuthenticatedNativeOriginalInventoryManifestChunk as inspect,
 closeAuthenticatedNativeOriginalInventoryManifestChunk as close} from '../src/native-original-inventory-manifest-chunk.js';
import {recoveryDeniedEffects as denied} from '../src/same-original-recovery-wire.js';
import {nativeOriginalInventoryManifestChunkStatusWire as SW,decodeNativeOriginalInventoryManifestChunkStatus as decodeStatus}
 from '../src/native-original-inventory-manifest-chunk-status.js';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const hmac=(secret,v)=>createHmac('sha256',secret).update(v).digest('hex');
function pieceBody(target,parent,manifest,index,bytes,secret,change={}){
 const body={schema:W.schema,purpose:W.purpose,inventory_native_request_id:parent.p_native_request,
  registration_request_body_sha256:parent.p_native_request_body_sha256,
  intent_document_sha256:parent.intent_document_sha256,intent_disk_sha256:parent.intent_disk_sha256,original_target:target,
  manifest_sha256:sha(manifest),manifest_byte_count:String(manifest.length),manifest_chunk_count:String(Math.ceil(manifest.length/W.chunkBytes)),
  manifest_chunk_index:String(index),chunk_base64:bytes.toString('base64'),chunk_sha256:sha(bytes),...change};
 body.purpose_binding_sha256=sha([W.purposeVersion,body.inventory_native_request_id,body.registration_request_body_sha256,
  body.intent_document_sha256,body.intent_disk_sha256,body.manifest_sha256,body.manifest_byte_count,body.manifest_chunk_count,
  body.manifest_chunk_index,body.chunk_sha256].join('\n'));
 body.purpose_attestation=hmac(secret,[W.purposeVersion,target.credential_id,body.purpose_binding_sha256].join('\n'));
 return body;
}
function signedRequest(body,secret,id=randomUUID()){
 const raw=Buffer.from(JSON.stringify(body)),timestamp=new Date().toISOString(),t=body.original_target;
 return {method:'POST',url:W.path,path:W.path,originalUrl:W.path,aborted:false,scanAuthorityRawBody:raw,
  headers:{authorization:'Device '+t.credential_id+'.'+secret,origin:'https://localhost','x-device-id':t.canonical_device_id,
   'x-memphis-app-edition':'custodial','x-memphis-native-attestation-version':'custodial-native-request.v1',
   'x-memphis-native-request-id':id,'x-memphis-native-request-timestamp':timestamp,
   'x-memphis-native-request-attestation':hmac(secret,['custodial-native-request.v1',t.credential_id,t.canonical_device_id,
    'POST',W.path,sha(raw),id,timestamp,'custodial'].join('\n'))}};
}
// Called ONLY by the existing isolated protected runner. Actual intended-role
// SQL + real current auth code; native manifest/manager fixture DATA synthetic.
export async function qualifyNativeInventoryManifestChunks({admin,target,originalParameters,parentIntent,env,secret}){
 const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
 const args=kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',');
 const rpc='public.custodial_register_original_inventory_manifest_chunk_v1',reader='public.custodial_read_original_inventory_manifest_chunk_v1';
 const table='public.custodial_native_inventory_manifest_chunks';
 const checks=[],parentBody=JSON.parse(originalParameters.p_original_request_utf8);
 const parent={...originalParameters,intent_document_sha256:parentBody.original_intent_document_sha256,intent_disk_sha256:parentBody.original_intent_disk_sha256};
 const manifest=Buffer.from('{"fixture":"SYNTHETIC_RAW_MANIFEST_NOT_PRIVATE_NATIVE_INVENTORY","original_text":"'+
  'retained🙂'.repeat(3700)+'","six_effect_permissions":false}\n');
 assert.ok(manifest.length>W.chunkBytes&&manifest.length<2*W.chunkBytes);
 async function role(actor,sql,values=[],readonly=true){
  assert.ok(['service_role','custodial_application_reader','anon','authenticated','static_weekly_control_plane','static_weekly_release_operator'].includes(actor));
  await admin.query(readonly?'begin read only':'begin');
  try{await admin.query('set local role '+actor);const result=await admin.query(sql,values);await admin.query('commit');return result.rows;}
  catch(e){await admin.query('rollback');throw e;}
 }
 const deps={env,store:{async findCredential(id){return (await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id]))[0];}},
  runReadOnlySql:sql=>role('custodial_application_reader',sql)};
 async function observed(index,change={}){
  const bytes=manifest.subarray(index*W.chunkBytes,Math.min(manifest.length,(index+1)*W.chunkBytes));
  const body=pieceBody(target,parent,manifest,index,bytes,secret,change),req=signedRequest(body,secret),before=Buffer.from(req.scanAuthorityRawBody);
  let cap;try{cap=await capture(req,{...deps,now:new Date()});const bound=inspect(cap);
   assert.equal(bound.transaction_authority,false);assert.deepEqual(req.scanAuthorityRawBody,before);
   for(const k of Object.keys(denied))assert.equal(cap[k],false);
   return fields.map(k=>bound.rpc_parameters[k]);
  }finally{if(cap)close(cap);req.scanAuthorityRawBody.fill(0);before.fill(0);}
 }
 const count=async()=>(await admin.query('select count(*)::int n from '+table)).rows[0].n;
 const before=await count();assert.equal(before,0);
 const p0=await observed(0),receipt0text=(await role('service_role','select '+rpc+'('+args+') data',p0,false))[0].data,r0=JSON.parse(receipt0text);
 assert.equal(r0.state,'CHUNK_RETAINED_NOT_ACK');assert.deepEqual(r0.limits,denied);assert.equal(await count(),1);
 checks.push('actual native-purpose auth capture -> intended role first original chunk commit; sixfalse');
 // Deliberate local loss after the actual commit; no second writer dispatch.
 let lost;try{throw Object.assign(new Error('SYNTHETIC_LOST_CHUNK_REPLY_AFTER_COMMIT'),{outcome:'UNKNOWN'});}catch(e){lost=e.outcome;}
 assert.equal(lost,'UNKNOWN');
 for(const actor of ['service_role','custodial_application_reader']){
  const row=(await role(actor,'select '+reader+'('+args+') data',p0))[0];assert.deepEqual(JSON.parse(row.data),r0);
 }
 assert.equal(await count(),1);checks.push('lost reply reads exact original receipt under BOTH actual READ ONLY intended readers, no resend');
 assert.equal((await admin.query('select custodial_recovery.retained_inventory_manifest_utf8($1) data',[parent.p_native_request])).rows[0].data,null);
 checks.push('partial chunk set remains unresolved/null, never complete manifest or ACK');
 await assert.rejects(role('service_role','select '+rpc+'('+args+') data',p0,false),e=>e.code==='23505');
 const mixed=await observed(1,{manifest_sha256:'0'.repeat(64)});
 await assert.rejects(role('service_role','select '+rpc+'('+args+') data',mixed,false),e=>e.code==='42501');
 assert.equal(await count(),1);checks.push('duplicate and mixed manifest refuse without changing first original');
 const changed=[...p0];changed[12]='\n'+changed[12];changed[10]=sha(changed[12]);
 await assert.rejects(role('custodial_application_reader','select '+reader+'('+args+') data',changed),e=>e.code==='42501');
 const wrongOwner=[...p0];wrongOwner[3]='0'.repeat(64);
 await assert.rejects(role('service_role','select '+rpc+'('+args+') data',wrongOwner,false),e=>e.code==='42501');
 checks.push('same-object/different original bytes and changed current credential refuse');
 const p1=await observed(1),r1=JSON.parse((await role('service_role','select '+rpc+'('+args+') data',p1,false))[0].data);
 assert.equal(r1.manifest_chunk_index,'1');assert.deepEqual(r1.limits,denied);assert.equal(await count(),2);
 const full=(await admin.query('select custodial_recovery.retained_inventory_manifest_utf8($1) data',[parent.p_native_request])).rows[0].data;
 assert.equal(full,manifest.toString('utf8'));assert.equal(sha(full),sha(manifest));
 checks.push('two exact original chunks assemble byte-for-byte UTF8, no normalization/omission or semantic promotion');
 const metadata=(await admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[table])).rows[0];
 assert.deepEqual(metadata,{relrowsecurity:true,relforcerowsecurity:true});
 const triggers=(await admin.query("select tgname,tgenabled from pg_trigger where tgrelid=$1::regclass and tgname in ('native_inventory_manifest_immutable','native_inventory_manifest_no_truncate') order by tgname",[table])).rows;
 assert.equal(triggers.length,2);assert.ok(triggers.every(t=>t.tgenabled==='A'));
 for(const actor of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  assert.equal((await admin.query("select has_table_privilege($1,$2,'select,insert,update,delete,truncate') allowed",[actor,table])).rows[0].allowed,false);
  assert.equal((await admin.query("select has_function_privilege($1,'custodial_recovery.retained_inventory_manifest_utf8(uuid)','execute') allowed",[actor])).rows[0].allowed,false);
  if(!['service_role','custodial_application_reader'].includes(actor))
   await assert.rejects(role(actor,'select '+reader+'('+args+') data',p0),e=>e.code==='42501');
  if(actor!=='service_role')await assert.rejects(role(actor,'select '+rpc+'('+args+') data',p0,false),e=>e.code==='42501');
 }
 checks.push('actual denied callers, no runtime table/private assembly privileges, FORCE RLS and ALWAYS guards retained');
 for(const sql of ['update '+table+' set manifest_sha256=manifest_sha256','delete from '+table,'truncate '+table]){
  await admin.query('begin');try{await assert.rejects(admin.query(sql),e=>['42501','55000'].includes(e.code));}finally{await admin.query('rollback');}
 }
 assert.equal(await count(),2);assert.equal((await role('custodial_application_reader','select '+reader+'('+args+') data',p0))[0].data,receipt0text);
 // PostgreSQL jsonb text has spacing: exact persisted receipt is authoritative.
 checks.push('owner UPDATE/DELETE/TRUNCATE refused; exact immutable originals remain');
 manifest.fill(0);
 return {checks,actual_SQL:true,actual_READ_ONLY:true,actual_HTTP:false,rows:2,inventory_source:'SYNTHETIC_MANIFEST_DATA_NOT_PRIVATE_NATIVE_BROWSER_ISSUER',
  semantic_review:false,ACK:false,finalizer:false,key_removal:false,real_manager:false,Android:false,production:false};
}
// NEW changed owning HTTP->SQL join only. Existing SQL eight groups and old
// HTTP members are NOT replayed. Parent/native/manager records are prerequisites.
export async function qualifyNativeInventoryManifestChunkHttpStatus({admin,target,originalParameters,env,secret}){
 const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'],args=kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',');
 async function role(actor,sql,values=[],readonly=true){
  assert.ok(['service_role','custodial_application_reader'].includes(actor));await admin.query(readonly?'begin read only':'begin');
  try{await admin.query('set local role '+actor);const result=await admin.query(sql,values);await admin.query('commit');return result.rows;}
  catch(e){await admin.query('rollback');throw e;}
 }
 const parentBody=JSON.parse(originalParameters.p_original_request_utf8),parent={...originalParameters,
  intent_document_sha256:parentBody.original_intent_document_sha256,intent_disk_sha256:parentBody.original_intent_disk_sha256};
 const piece=Buffer.from('NEW_SIGNED_HTTP_SQL_STATUS_SYNTHETIC_MANIFEST_NOT_NATIVE_ISSUER'),body=pieceBody(target,parent,piece,0,piece,secret),original=signedRequest(body,secret);
 const raw=Buffer.concat([original.scanAuthorityRawBody,Buffer.alloc(W.maxRequestBytes-original.scanAuthorityRawBody.length,32)]);
 original.scanAuthorityRawBody.fill(0);original.scanAuthorityRawBody=raw;
 const id=original.headers['x-memphis-native-request-id'],time=original.headers['x-memphis-native-request-timestamp'];
 original.headers['x-memphis-native-request-attestation']=hmac(secret,['custodial-native-request.v1',target.credential_id,target.canonical_device_id,
  'POST',W.path,sha(raw),id,time,'custodial'].join('\n'));
 const envelope={schema:SW.schema,purpose:SW.purpose,original_request_utf8:raw.toString('utf8'),original_request_timestamp:time,
  original_request_attestation:original.headers['x-memphis-native-request-attestation']};
 let writerCalls=0,readerCalls=0,retained=null;const clients=new Set(),app=express();
 installSameOriginalRecoveryNativeChallengeComposition(app,{env,store:{async findCredential(value){
  return (await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[value]))[0];}},
  async runReadOnlySql(sql){if(sql.startsWith('select public.custodial_read_original_inventory_manifest_chunk_v1('))readerCalls++;
   return role('custodial_application_reader',sql);},db:{async rpc(name,p){
    writerCalls++;assert.equal(name,'custodial_register_original_inventory_manifest_chunk_v1');assert.equal(writerCalls,1);
    const rows=await role('service_role','select public.custodial_register_original_inventory_manifest_chunk_v1('+args+') as data',fields.map(k=>p[k]),false);
    retained=JSON.parse(rows[0].data);throw new Error('DELIBERATE_LOST_REPLY_AFTER_ACTUAL_ORIGINAL_CHUNK_COMMIT');
   }}});
 app.use(express.json());const server=http.createServer(app);let address;
 server.on('connection',socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));});
 const checks=[];
 async function send(path,bytes,headers){return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:address.port,path,method:'POST',agent:false,
   headers:{...headers,'content-type':'application/json','content-length':String(bytes.length)}},res=>{
    const parts=[];let size=0;res.on('data',p=>{size+=p.length;if(size>16384)req.destroy(new Error('bounded SQL status reply'));else parts.push(p);});
    res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString('utf8'))});}
     catch(e){reject(e);}finally{for(const p of parts)p.fill(0);}});
   });req.setTimeout(10000,()=>req.destroy(new Error('bounded actual SQL status timeout')));req.once('error',reject);req.end(bytes);
 });}
 async function status(value){const bytes=Buffer.from(JSON.stringify(value)),now=new Date().toISOString();
  try{return await send(SW.path,bytes,{...original.headers,'x-memphis-native-request-timestamp':now,
   'x-memphis-native-request-attestation':hmac(secret,['custodial-native-request.v1',target.credential_id,target.canonical_device_id,
    'POST',SW.path,sha(bytes),id,now,'custodial'].join('\n'))});}finally{bytes.fill(0);}}
 try{
  assert.equal((await admin.query('select count(*)::int n from public.custodial_native_inventory_manifest_chunks')).rows[0].n,0);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});address=server.address();
  const lost=await send(W.path,raw,original.headers);assert.equal(lost.status,503);assert.equal(lost.body.outcome,'UNKNOWN');assert.equal(lost.body.retry_safe,false);
  assert.equal(writerCalls,1);assert.equal(readerCalls,0);assert.ok(retained);assert.deepEqual(retained.limits,denied);
  const recovered=await status(envelope);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.data,retained);
  assert.equal(readerCalls,1);assert.equal(writerCalls,1);
  const rows=(await admin.query('select native_request_id,original_request_utf8,native_request_timestamp,receipt_utf8 from public.custodial_native_inventory_manifest_chunks')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].native_request_id,id);assert.equal(rows[0].original_request_utf8,raw.toString('utf8'));
  assert.deepEqual(JSON.parse(rows[0].receipt_utf8),retained);checks.push('actual signed HTTP WRITE -> one intended SQL commit -> lost reply -> current signed HTTP READ -> exact intended READ ONLY original receipt; no resend');
  const refused=await status({...envelope,original_request_utf8:envelope.original_request_utf8+'\n'});
  assert.equal(refused.status,403);assert.equal(writerCalls,1);assert.equal(readerCalls,1);
  assert.equal((await admin.query('select count(*)::int n from public.custodial_native_inventory_manifest_chunks')).rows[0].n,1);
  checks.push('fresh signed READ cannot substitute changed archived body; immutable original remains exactly once');
  return {checks,actual_HTTP:true,actual_SQL:true,actual_READ_ONLY:true,raw_original_bytes:raw.length,
   status_envelope_bytes:Buffer.byteLength(JSON.stringify(envelope)),writer_calls:writerCalls,fixed_reader_calls:readerCalls,
   original_body_sha256:sha(raw),original_native_request_id:id,original_timestamp:time,loopback:address,
   all_owned_servers_closed_on_return:true,inventory_source:'SYNTHETIC_MANIFEST_NOT_PRIVATE_NATIVE_BROWSER_ISSUER',
   semantic_review:false,ACK:false,finalizer:false,key_removal:false,real_manager:false,Android:false,production:false};
 }finally{
  if(server.listening)await new Promise(resolve=>server.close(resolve));for(const socket of clients)socket.destroy();
  assert.equal(server.listening,false);raw.fill(0);piece.fill(0);
 }
}
// Newly added manager-source RPC only: complete immutable raw DATA is not an
// accepted semantic manifest, a review or an ACK. Older SQL/HTTP groups do not run.
async function qualifyNativeInventoryManagerDecision({admin,target,originalParameters,managerArguments,review,role,
 managerDecisionHttpOnly=false,originalRequestHeaders=null,managerDecisionHttpRequest=null}){
 const {createOriginalInventorySeparationStore}=await import('../src/original-inventory-separation-store.js');
 const {validateInventorySeparationReceipt}=await import('../src/original-inventory-separation-wire.js');
 const table='public.custodial_original_inventory_separation_approvals',checks=[];
 const issuer=Object.freeze({manager_id:managerArguments[0],manager_credential_id:managerArguments[1],manager_device_id:managerArguments[2]});
 const session=(await admin.query('select expires_at from public.ops_manager_device_security_sessions where session_id=$1',[managerArguments[4]])).rows[0];
 const signed=(await admin.query('select signed_session_sha256 from public.custodial_same_original_recovery_approvals where security_session_id=$1',[managerArguments[4]])).rows;
 assert.equal(signed.length,1);
 const mk=['uuid','uuid','text','timestamptz','uuid','integer','text','text'],names=['p_manager','p_credential','p_device','p_signed_expires',
  'p_security_session','p_password_version','p_security_hash','p_csrf_hash'];
 const nativeNames=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const nativeKinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
 const nsql='select public.custodial_read_native_original_inventory_separation_approval_v1('+nativeKinds.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data';
 const nativeArgs=nativeNames.map(k=>originalParameters[k]),count=async()=>(await admin.query('select count(*)::int n from '+table)).rows[0].n;
 let writes=0;const calls=[];
 const store=createOriginalInventorySeparationStore({db:{async rpc(name,args){
  calls.push(name);const issue=name==='custodial_original_inventory_separation_issue_v1';
  assert.ok(['custodial_original_inventory_separation_manifest_v1','custodial_original_inventory_separation_review_v1',
   'custodial_original_inventory_separation_issue_v1','custodial_original_inventory_separation_status_v1'].includes(name));
  const keys=[...names,...(issue?['p_signed_sha']:[]),...(name.endsWith('manifest_v1')||name.endsWith('review_v1')?['p_inventory_request']:['p_original_utf8'])];
  const types=[...mk,...(issue?['text']:[]),name.endsWith('manifest_v1')||name.endsWith('review_v1')?'uuid':'text'];
  const data=(await role('service_role','select public.'+name+'('+types.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+') data',keys.map(k=>args[k]),!issue))[0].data;
  if(issue){writes++;assert.equal(writes,1);throw Error('SYNTHETIC_LOST_ORIGINAL_INVENTORY_DECISION_REPLY_AFTER_SQL_COMMIT');}
  return {data,error:null,count:null,status:200,statusText:'OK'};
 }},inspectAuthenticatedIssuer(candidate){assert.equal(candidate,issuer);return {issuer,observation_only:true,transaction_authority:false,confirmation_csrf_verified:true,
  signed_session_expires_at:new Date(managerArguments[3]).toISOString(),security_session_id:managerArguments[4],security_password_version:managerArguments[5],
  security_token_hash:managerArguments[6],security_csrf_hash:managerArguments[7],signed_session_sha256:signed[0].signed_session_sha256,
  security_session_expires_at:new Date(session.expires_at).toISOString()};}});
 const before=(await admin.query('select (select count(*) from public.custodial_native_private_custody_operations)::int operations,'+
  '(select count(*) from public.custodial_native_private_custody_chunks)::int chunks,'+
  '(select count(*) from public.custodial_native_inventory_requests)::int parents,'+
  '(select count(*) from public.custodial_native_inventory_manifest_chunks)::int manifests')).rows[0];
 assert.equal(await count(),0);assert.equal((await role('service_role',nsql,nativeArgs))[0].data,null);
 const current=await store.readVerifiedInventory({nativeRequestId:review.native_request_id,issuer});assert.equal(current.review_sha256,review.review_sha256);
 const request={schema:'custodial.original-inventory-separation-request.v1',request_id:randomUUID(),native_request_id:review.native_request_id,
  expected_review_sha256:review.review_sha256,expected_inventory_manifest_sha256:review.inventory_manifest_sha256,
  expected_registration_receipt_sha256:review.registration_receipt_sha256,expected_separation_authority_revision:target.separation_authority_revision,
  expected_manager_id:issuer.manager_id,expected_manager_credential_id:issuer.manager_credential_id,expected_manager_device_id:issuer.manager_device_id,
  decision:'AUTHORIZE_EXACT_ORIGINAL_RETAINED_INVENTORY_SEPARATION',manager_confirmation:'CONFIRM_LOGICAL_SEPARATION_KEEP_ALL_ORIGINAL_WORK_AND_KEYS'};
 const original=' \n'+JSON.stringify(request)+'\t';
 await assert.rejects(store.issueOriginalInventoryApprovalOnce({originalRequest:request,originalRequestUtf8:original,issuer,verifiedReview:current}),
  e=>e.outcome==='UNKNOWN'&&e.retry_safe===false);
 assert.equal(writes,1);assert.equal(await count(),1);
 const saved=(await admin.query('select original_request_utf8,original_request_sha256,receipt_utf8 from '+table)).rows[0];
 assert.equal(saved.original_request_utf8,original);assert.equal(saved.original_request_sha256,sha(original));
 checks.push('ONE normal shipping store issue -> actual current-manager/original-frame SQL transaction commits; deliberate reply loss stays UNKNOWN with one immutable raw original');
 if(managerDecisionHttpOnly)return await qualifyNativeInventoryManagerDecisionHttp({admin,target,originalParameters,managerArguments,
  request,original,saved,table,before,count,writes,calls,originalRequestHeaders,managerDecisionHttpRequest});
 const callCount=calls.length,receipt=validateInventorySeparationReceipt(await store.readOriginalInventoryApproval({originalRequest:request,originalRequestUtf8:original,issuer}));
 assert.deepEqual(calls.slice(callCount),['custodial_original_inventory_separation_status_v1']);assert.equal(writes,1);
 assert.equal(receipt.original_request_sha256,sha(original));assert.deepEqual(receipt.original_request,request);assert.deepEqual(receipt.original_target,target);
 assert.deepEqual(receipt.limits,{...denied,inventory_acknowledged:true,finalizer_allowed:true});
 assert.deepEqual(JSON.parse((await role('service_role',nsql,nativeArgs))[0].data),receipt);
 assert.equal((await admin.query('select receipt_utf8 from '+table)).rows[0].receipt_utf8,saved.receipt_utf8);assert.equal(await count(),1);
 checks.push('lost reply recovers SAME raw decision by fixed intended READ ONLY manager status + current native original reader; no writer resend or freshness renewal');
 const ws=[...managerArguments,signed[0].signed_session_sha256,original],wtypes=[...mk,'text','text'];
 const wsql='select public.custodial_original_inventory_separation_issue_v1('+wtypes.map((k,i)=>'$'+(i+1)+'::'+k).join(',')+')';
 await assert.rejects(role('service_role',wsql,ws,false),e=>e.code==='23505');
 const ss='select public.custodial_original_inventory_separation_status_v1('+[...mk,'text'].map((k,i)=>'$'+(i+1)+'::'+k).join(',')+')';
 await assert.rejects(role('service_role',ss,[...managerArguments,'\n'+original]),e=>e.code==='42501');
 const badNative=[...nativeArgs];badNative[8]=randomUUID();await assert.rejects(role('service_role',nsql,badNative),e=>e.code==='42501');
 assert.equal(await count(),1);checks.push('explicit adversarial duplicate writer and changed raw/native original status refuse, never replace original decision');
 // Only disposable owner state inside this exact test transaction. No real
 // session/password/credential or permission is changed; rollback is mandatory.
 await admin.query('begin');let denial;
 try{await admin.query('update public.ops_manager_device_security_config set password_version=password_version+1 where singleton');
  await admin.query('set local role service_role');await admin.query(nsql,nativeArgs);
 }catch(e){denial=e;}finally{await admin.query('rollback');}
 assert.equal(denial?.code,'42501');assert.deepEqual(JSON.parse((await role('service_role',nsql,nativeArgs))[0].data),receipt);
 checks.push('actual issuing-password withdrawal invalidates current native decision read; rolled-back synthetic change restores only the unchanged original');
 for(const actor of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await assert.rejects(role(actor,ss,[...managerArguments,original]),e=>e.code==='42501');
  await assert.rejects(role(actor,nsql,nativeArgs),e=>e.code==='42501');
 }
 await assert.rejects(role('service_role','select * from '+table),e=>e.code==='42501');
 await assert.rejects(admin.query('delete from '+table+' where request_id=$1',[request.request_id]),e=>e.code==='42501');
 const flags=(await admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[table])).rows[0];
 assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});
 assert.equal((await admin.query("select count(*)::int n from pg_trigger where tgrelid=$1::regclass and tgenabled='A' and tgname in ('original_inventory_approval_immutable','original_inventory_approval_no_truncate')",[table])).rows[0].n,2);
 assert.equal(await count(),1);assert.equal((await admin.query('select receipt_utf8 from '+table)).rows[0].receipt_utf8,saved.receipt_utf8);
 const after=(await admin.query('select (select count(*) from public.custodial_native_private_custody_operations)::int operations,'+
  '(select count(*) from public.custodial_native_private_custody_chunks)::int chunks,'+
  '(select count(*) from public.custodial_native_inventory_requests)::int parents,'+
  '(select count(*) from public.custodial_native_inventory_manifest_chunks)::int manifests')).rows[0];assert.deepEqual(after,before);
 checks.push('actual denied roles/direct table denial, owner immutable deletion refusal, FORCE RLS+ALWAYS guards; all prior original frame/parent/manifest rows retained');
 return {checks,actual_SQL:true,actual_READ_ONLY_status:true,shipping_store:true,inspector:'SYNTHETIC_CURRENT_MANAGER_FIXTURE_NOT_GENUINE_AUTH',
  semantic_inventory:'PENDING_ONLY',accepted_original_workflow:'NOT_RUN',decision_records:1,application_writer_dispatches:writes,
  raw_original_sha256:sha(original),receipt_sha256:receipt.receipt_sha256,actual_HTTP:false,actual_native_manifest_producer:false,real_manager:false,
  native_private_ACK:false,finalizer:false,key_removal:false,phone_release:false,production:false};
}
// Called only after the existing ONE actual decision issue commits and its
// manager reply is lost. Reuse the parent's already-mounted HTTP fixture;
// do not open another server or replay the prior five decision proof groups.
async function qualifyNativeInventoryManagerDecisionHttp({admin,target,originalParameters,managerArguments,
 request,original,saved,table,before,count,writes,calls,originalRequestHeaders,managerDecisionHttpRequest}){
 const {nativeOriginalInventorySeparationApprovalStatusWire:wire}=await import('../src/native-original-inventory-status.js');
 const {validateInventorySeparationReceipt}=await import('../src/original-inventory-separation-wire.js');
 assert.equal(typeof managerDecisionHttpRequest,'function');assert.equal(writes,1);assert.equal(await count(),1);
 const archivedHeaders=structuredClone(originalRequestHeaders),nativeOriginal=originalParameters.p_original_request_utf8;
 assert.equal(typeof nativeOriginal,'string');assert.equal(sha(nativeOriginal),originalParameters.p_native_request_body_sha256);
 assert.equal(archivedHeaders['x-memphis-native-request-id'],originalParameters.p_native_request);
 assert.equal(archivedHeaders['x-memphis-native-request-timestamp'],originalParameters.p_native_request_timestamp);
 assert.match(archivedHeaders['x-memphis-native-request-attestation'],/^[a-f0-9]{64}$/);
 const envelope={schema:wire.schema,purpose:wire.purpose,original_request_utf8:nativeOriginal,
  original_request_timestamp:archivedHeaders['x-memphis-native-request-timestamp'],
  original_request_attestation:archivedHeaders['x-memphis-native-request-attestation']};
 // Only the existing parent's request() creates a FRESH outer READ HMAC.
 // This child cannot reconstruct/re-sign archived original headers or nonce.
 const body=JSON.stringify(envelope),callCount=calls.length;
 const observed=await managerDecisionHttpRequest(wire.path,body,new Date().toISOString());
 assert.equal(observed.status,200,JSON.stringify(observed.body));assert.deepEqual(Object.keys(observed.body).sort(),['data','ok']);
 assert.equal(observed.body.ok,true);
 const receipt=validateInventorySeparationReceipt(observed.body.data),stored=validateInventorySeparationReceipt(JSON.parse(saved.receipt_utf8));
 assert.deepEqual(receipt,stored,'normal mounted HTTP must return the actual immutable SQL receipt, never a seeded response');
 assert.deepEqual(receipt.original_request,request);assert.deepEqual(receipt.original_target,target);
 assert.equal(receipt.original_request_sha256,saved.original_request_sha256);assert.equal(receipt.original_request_sha256,sha(original));
 assert.deepEqual(receipt.limits,{...denied,inventory_acknowledged:true,finalizer_allowed:true});
 assert.equal(observed.headers['x-memphis-native-request-id'],archivedHeaders['x-memphis-native-request-id']);
 const checks=['ONE existing normal manager-store issue commits actual SQL decision; lost manager reply is prerequisite UNKNOWN, no second application write',
  'normal mounted native approval HTTP -> actual fixed service-role READ ONLY SQL -> exact immutable original decision receipt'];
 function unknown(result){
  assert.ok([403,503].includes(result.status),JSON.stringify(result.body));assert.equal(result.body.outcome,'UNKNOWN');
  assert.equal(result.body.retry_safe,false);assert.deepEqual(result.body.limits,denied);
 }
 // Change only archived body bytes; keep the ACTUALLY CAPTURED old signature.
 // Fresh outer authentication must not turn changed originals into authority.
 const changed=await managerDecisionHttpRequest(wire.path,JSON.stringify({...envelope,original_request_utf8:nativeOriginal+'\n'}),new Date().toISOString());
 unknown(changed);assert.equal(writes,1);assert.equal(calls.length,callCount);
 checks.push('changed archived original with unchanged actual old HMAC refuses; no approval reader substitution or writer retry');
 // LAST: withdraw the issuing password version in this disposable fixture.
 // Do not nest the HTTP reader's own READ ONLY transactions inside an owner
 // transaction, and do not roll authority back/revive it after the refusal.
 // The protected runner owns disposal of this isolated database afterwards.
 const config=(await admin.query('select password_version from public.ops_manager_device_security_config where singleton')).rows;
 assert.equal(config.length,1);const previous=config[0].password_version;
 assert.ok(Number.isSafeInteger(previous)&&previous>0);
 const withdrawn=(await admin.query('update public.ops_manager_device_security_config set password_version=password_version+1 '+
  'where singleton and password_version=$1 returning password_version',[previous])).rows;
 assert.deepEqual(withdrawn,[{password_version:previous+1}]);
 const unavailable=await managerDecisionHttpRequest(wire.path,body,new Date().toISOString());unknown(unavailable);
 assert.equal((await admin.query('select password_version from public.ops_manager_device_security_config where singleton')).rows[0].password_version,previous+1);
 checks.push('actual issuing-authority withdrawal -> mounted HTTP UNKNOWN with no resend; synthetic authority remains withdrawn until fixture disposal');
 assert.equal(await count(),1);assert.equal(calls.length,callCount);assert.equal(writes,1);
 const retained=(await admin.query('select original_request_utf8,original_request_sha256,receipt_utf8 from '+table)).rows;
 assert.deepEqual(retained,[saved],'exact original manager command/hash/receipt remain unchanged after all READ outcomes');
 assert.deepEqual(originalRequestHeaders,archivedHeaders);assert.equal(originalParameters.p_original_request_utf8,nativeOriginal);
 const after=(await admin.query('select (select count(*) from public.custodial_native_private_custody_operations)::int operations,'+
  '(select count(*) from public.custodial_native_private_custody_chunks)::int chunks,'+
  '(select count(*) from public.custodial_native_inventory_requests)::int parents,'+
  '(select count(*) from public.custodial_native_inventory_manifest_chunks)::int manifests')).rows[0];assert.deepEqual(after,before);
 checks.push('one decision and all prior operation/chunk/parent/manifest counts retained; captured archived original headers/UTF8 unchanged');
 return {checks,actual_HTTP:true,actual_SQL:true,actual_READ_ONLY_status:true,shipping_store:true,
  inspector:'EXISTING_SYNTHETIC_CURRENT_MANAGER_FIXTURE_NOT_GENUINE_AUTH',semantic_inventory:'PENDING_ONLY',
  accepted_original_workflow:'NOT_RUN',decision_records:1,application_writer_dispatches:writes,
  raw_original_sha256:sha(original),receipt_sha256:receipt.receipt_sha256,archived_headers:'ACTUAL_FIRST_REQUEST_NOT_RECONSTRUCTED_OR_RESIGNED',
  synthetic_issuing_password_withdrawn_until_fixture_disposal:true,actual_native_manifest_producer:false,real_manager:false,
  native_private_ACK:false,finalizer:false,key_removal:false,phone_release:false,production:false};
}
export async function qualifyNativeInventoryManifestSemanticReview({admin,target,originalParameters,env,secret,managerArguments,managerDecisionOnly=false,
 managerDecisionHttpOnly=false,originalRequestHeaders=null,managerDecisionHttpRequest=null}){
 assert.equal(typeof managerDecisionHttpOnly,'boolean');
 if(managerDecisionHttpOnly){
  assert.equal(typeof managerDecisionHttpRequest,'function','Reuse the existing normal registration HTTP fixture, not a new server');
  assert.ok(originalRequestHeaders&&typeof originalRequestHeaders==='object','ACTUALLY captured first request headers required');
  assert.equal(originalRequestHeaders['x-memphis-native-request-id'],originalParameters.p_native_request);
  assert.equal(originalRequestHeaders['x-memphis-native-request-timestamp'],originalParameters.p_native_request_timestamp);
  assert.match(originalRequestHeaders['x-memphis-native-request-attestation'],/^[a-f0-9]{64}$/);
 }
 const {createOriginalInventoryManifestFixture}=await import('./native-original-inventory-manifest-tests.mjs');
 const {validateInventorySeparationReview}=await import('../src/original-inventory-separation-wire.js');
 const {createOriginalInventorySeparationStore}=await import('../src/original-inventory-separation-store.js');
 const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const kinds=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
 const signature=kinds.map((k,i)=>'$'+(i+1)+'::'+k).join(','),mk=['uuid','uuid','text','timestamptz','uuid','integer','text','text','uuid'];
 const ms=mk.map((k,i)=>'$'+(i+1)+'::'+k).join(',');
 async function role(actor,sql,args=[],readonly=true){
  assert.ok(['service_role','custodial_application_reader','anon','authenticated','static_weekly_control_plane','static_weekly_release_operator'].includes(actor));
  await admin.query(readonly?'begin read only':'begin');
  try{await admin.query('set local role '+actor);const rows=(await admin.query(sql,args)).rows;await admin.query('commit');return rows;}
  catch(e){await admin.query('rollback');throw e;}
 }
 const parentBody=JSON.parse(originalParameters.p_original_request_utf8),intent=JSON.parse(parentBody.original_intent_utf8);
 const parent={...originalParameters,intent_document_sha256:parentBody.original_intent_document_sha256,
  intent_disk_sha256:parentBody.original_intent_disk_sha256};
 const value=createOriginalInventoryManifestFixture(),forged=structuredClone(value.native_records.find(r=>r.completion_readback).completion_readback);
 value.schema='custodial.native-original-complete-inventory-manifest.v2';value.original_target=structuredClone(target);
 value.native_request_id=parent.p_native_request;value.registration_request_body_sha256=parent.p_native_request_body_sha256;
 value.intent_document_sha256=parent.intent_document_sha256;value.intent_disk_sha256=parent.intent_disk_sha256;
 value.native_held_stamp=intent.native_held_stamp;value.browser_part_set_sha256=intent.browser_part_set_sha256;
 value.browser_value_frame.frame_sha256=intent.browser_frame_sha256;value.browser_value_frame.chunk_sha256=[intent.browser_frame_sha256];
 for(const row of [...value.native_records,...value.browser_records]){row.disposition='UNRESOLVED_RETAINED';row.completion_readback=null;}
 for(const item of value.native_namespaces){item.accepted_exact_original_count=0;item.unresolved_retained_count=item.record_count;}
 value.browser_accepted_exact_original_count=0;value.browser_unresolved_retained_count=value.browser_records.length;
 const manifest=Buffer.from(JSON.stringify(value)),checks=[],params=[...managerArguments,parent.p_native_request];let writerCalls=0;
 const deps={env,store:{async findCredential(id){return (await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id]))[0];}},
  runReadOnlySql:sql=>role('custodial_application_reader',sql)};
 const review=async(args=params)=>(await role('service_role','select public.custodial_original_inventory_separation_review_v1('+ms+') data',args))[0].data;
 try{
  for(let index=0;index<Math.ceil(manifest.length/W.chunkBytes);index++){
   const req=signedRequest(pieceBody(target,parent,manifest,index,manifest.subarray(index*W.chunkBytes,(index+1)*W.chunkBytes),secret),secret);let cap;
   try{cap=await capture(req,{...deps,now:new Date()});const p=inspect(cap).rpc_parameters;
    await role('service_role','select public.custodial_register_original_inventory_manifest_chunk_v1('+signature+') data',fields.map(k=>p[k]),false);writerCalls++;
   }finally{if(cap)close(cap);req.scanAuthorityRawBody.fill(0);}
  }
  const first=validateInventorySeparationReview(await review());
  assert.deepEqual(first.original_target,target);assert.deepEqual(first.limits,denied);assert.equal(first.native_request_id,parent.p_native_request);
  assert.equal(first.inventory_manifest_sha256,sha(manifest));assert.equal(first.browser_summary.accepted_exact_original_count,0);
  assert.equal(first.browser_summary.unresolved_retained_count,value.browser_records.length);
  for(const partition of first.native_namespaces)assert.equal(partition.accepted_exact_original_count,0);
  if(managerDecisionOnly||managerDecisionHttpOnly)return await qualifyNativeInventoryManagerDecision({admin,target,originalParameters,managerArguments,review:first,role,
   ...(managerDecisionHttpOnly?{managerDecisionHttpOnly,originalRequestHeaders,managerDecisionHttpRequest}:{})});
  const again=validateInventorySeparationReview(await review());assert.equal(again.review_sha256,first.review_sha256);
  assert.equal(again.reviewed_at,first.reviewed_at);assert.equal(again.expires_at,first.expires_at);
  checks.push('actual intended READ ONLY semantic review of complete pending-only v2 inventory; stable original review identity, sixfalse and no ACK');
  const expires=(await admin.query('select expires_at from public.ops_manager_device_security_sessions where session_id=$1',[managerArguments[4]])).rows[0].expires_at;
  const issuer=Object.freeze({manager_id:managerArguments[0],manager_credential_id:managerArguments[1],manager_device_id:managerArguments[2]});
  const names=['p_manager','p_credential','p_device','p_signed_expires','p_security_session','p_password_version','p_security_hash','p_csrf_hash','p_inventory_request'];
  const store=createOriginalInventorySeparationStore({db:{async rpc(name,args){
   assert.ok(['custodial_original_inventory_separation_manifest_v1','custodial_original_inventory_separation_review_v1'].includes(name));
   return {data:(await role('service_role','select public.'+name+'('+ms+') data',names.map(k=>args[k])))[0].data,error:null,count:null,status:200,statusText:'OK'};
  }},inspectAuthenticatedIssuer(candidate){assert.equal(candidate,issuer);return {issuer,observation_only:true,transaction_authority:false,
   signed_session_expires_at:new Date(managerArguments[3]).toISOString(),security_session_id:managerArguments[4],security_password_version:managerArguments[5],
   security_token_hash:managerArguments[6],security_csrf_hash:managerArguments[7],signed_session_sha256:'a'.repeat(64),
   security_session_expires_at:new Date(expires).toISOString()};}});
  const joined=await store.readVerifiedInventory({nativeRequestId:parent.p_native_request,issuer});assert.equal(joined.review_sha256,first.review_sha256);
  checks.push('shipping complete-manifest decoder + repaired manager store consumes actual source/review jsonb under intended SQL role; inspector explicitly fixture-only');
  forged.original_arguments_utf8='{}';forged.argument_sha256=sha('{}');forged.readback.argument_values_sha256=sha('{}');
  forged.readback.operation_id=target.operation_id;forged.readback.original_generation_id=target.original_generation_id;
  // Direct owner-only assertion reaches the unchanged actual exact reader.
  // A copied accepted label/result with no actual original arguments refuses;
  // this is NOT a positive accepted-original workflow qualification.
  await assert.rejects(admin.query('select custodial_recovery.inventory_completion_current($1::jsonb,$2::text,$3::jsonb)',
   [JSON.stringify(forged),'CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK',JSON.stringify(target)]),e=>e.code==='22023');
  checks.push('forged accepted readback cannot replace exact original completion arguments; actual fixed reader refuses malformed original');
  const wrong=[...params];wrong[7]='0'.repeat(64);await assert.rejects(review(wrong),e=>e.code==='42501');
  for(const actor of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
   await assert.rejects(role(actor,'select public.custodial_original_inventory_separation_review_v1('+ms+')',params),e=>e.code==='42501');
  await assert.rejects(role('service_role','select custodial_recovery.review_original_inventory('+ms+')',params),e=>e.code==='42501');
  assert.equal((await review()).review_sha256,first.review_sha256);
  checks.push('actual changed current session and denied public/private callers refuse; original inventory/review remain unchanged');
  return {checks,actual_SQL:true,actual_READ_ONLY:true,actual_HTTP:false,semantic_pending_review:true,accepted_original_workflow:'NOT_RUN',
   actual_native_manifest_producer:false,real_manager:false,source_bytes:manifest.length,manifest_sha256:sha(manifest),prerequisite_writer_calls:writerCalls,
   ACK:false,finalizer:false,key_removal:false,production:false};
 }finally{manifest.fill(0);}
}
export async function qualifyNativeInventoryManifestManagerSource({admin,target,originalParameters,env,secret,managerArguments}){
 const fields=['p_operation','p_device','p_credential','p_credential_hash','p_credential_key_id','p_generation','p_separation',
  'p_authority_revision','p_native_request','p_native_request_timestamp','p_native_request_body_sha256','p_native_attestation_digest','p_original_request_utf8'];
 const types=['uuid','uuid','uuid','text','text','uuid','uuid','text','uuid','timestamptz','text','text','text'];
 const args=types.map((kind,i)=>'$'+(i+1)+'::'+kind).join(','),managerKinds=['uuid','uuid','text','timestamptz','uuid','integer','text','text','uuid'];
 const managerArgs=managerKinds.map((kind,i)=>'$'+(i+1)+'::'+kind).join(','),source='public.custodial_original_inventory_separation_manifest_v1';
 assert.ok(Array.isArray(managerArguments)&&managerArguments.length===8);
 async function role(actor,sql,values=[],readonly=true){
  assert.ok(['service_role','custodial_application_reader','anon','authenticated','static_weekly_control_plane','static_weekly_release_operator'].includes(actor));
  await admin.query(readonly?'begin read only':'begin');
  try{await admin.query('set local role '+actor);const result=await admin.query(sql,values);await admin.query('commit');return result.rows;}
  catch(e){await admin.query('rollback');throw e;}
 }
 const parentBody=JSON.parse(originalParameters.p_original_request_utf8),parent={...originalParameters,
  intent_document_sha256:parentBody.original_intent_document_sha256,intent_disk_sha256:parentBody.original_intent_disk_sha256};
 const params=[...managerArguments,parent.p_native_request],read=values=>role('service_role','select '+source+'('+managerArgs+') as data',values??params);
 const deps={env,store:{async findCredential(id){return (await role('service_role','select * from public.device_auth_credentials where credential_id=$1',[id]))[0];}},
  runReadOnlySql:sql=>role('custodial_application_reader',sql)};
 const manifest=Buffer.from('{"fixture":"SYNTHETIC_RAW_DATA_NOT_ELIGIBLE_MANIFEST","original_utf8":"'+'क🙂'.repeat(7000)+'"}\n');
 assert.ok(manifest.length>W.chunkBytes&&manifest.length<2*W.chunkBytes);
 const checks=[];let writes=0;
 const count=async()=>(await admin.query('select count(*)::int n from public.custodial_native_inventory_manifest_chunks')).rows[0].n;
 async function commit(index){
  const bytes=manifest.subarray(index*W.chunkBytes,Math.min(manifest.length,(index+1)*W.chunkBytes));
  const req=signedRequest(pieceBody(target,parent,manifest,index,bytes,secret),secret);let cap;
  try{cap=await capture(req,{...deps,now:new Date()});const p=inspect(cap).rpc_parameters;
   const rows=await role('service_role','select public.custodial_register_original_inventory_manifest_chunk_v1('+args+') as data',fields.map(k=>p[k]),false);
   const receipt=JSON.parse(rows[0].data);assert.deepEqual(receipt.limits,denied);writes++;
  }finally{if(cap)close(cap);req.scanAuthorityRawBody.fill(0);}
 }
 try{
  assert.equal(await count(),0);assert.equal((await read())[0].data,null);
  await commit(0);assert.equal((await read())[0].data,null);assert.equal(await count(),1);
  checks.push('actual intended READ ONLY source RPC returns NULL for missing/partial manifest, no exposure or complete review');
  await commit(1);const data=(await read())[0].data;
  assert.deepEqual(Object.keys(data).sort(),['schema','state','manifest_utf8','expected_original','original_registration_receipt_sha256',
   'observed_at','current_until','transaction_authority','limits'].sort());
  assert.equal(data.schema,'custodial.original-inventory-manifest-manager-source.v1');
  assert.equal(data.state,'CURRENT_MANAGER_ORIGINAL_MANIFEST_DATA_ONLY_NOT_REVIEW_OR_ACK');
  assert.equal(data.manifest_utf8,manifest.toString('utf8'));assert.equal(sha(data.manifest_utf8),sha(manifest));
  assert.deepEqual(data.expected_original,{inventory_native_request_id:parent.p_native_request,
   registration_request_body_sha256:parent.p_native_request_body_sha256,intent_document_sha256:parent.intent_document_sha256,
   intent_disk_sha256:parent.intent_disk_sha256,original_target:target,manifest_sha256:sha(manifest)});
  assert.deepEqual(data.limits,denied);assert.equal(data.transaction_authority,false);assert.equal(await count(),2);
  checks.push('complete raw multibyte original assembled byte-identically under current owner + native generation/source checks, jsonb source pins and sixfalse');
  const {decodeNativeOriginalInventoryManifest}=await import('../src/native-original-inventory-manifest.js');
  assert.throws(()=>decodeNativeOriginalInventoryManifest(Buffer.from(data.manifest_utf8),data.expected_original),
   e=>e.code==='native_original_inventory_manifest_invalid');
  checks.push('actual raw source DATA with invalid semantic root stays rejected by shipping decoder, never complete review/ACK');
  for(const [index,value] of [[0,randomUUID()],[5,Number(managerArguments[5])+1],[6,'0'.repeat(64)],[7,'0'.repeat(64)],
   [3,'2000-01-01T00:00:00.000Z']]){
   const wrong=[...params];wrong[index]=value;
   await assert.rejects(read(wrong),e=>['42501','P0002'].includes(e.code));
  }
  assert.equal(await count(),2);checks.push('foreign manager, password/session/CSRF mismatch and expired signed manager source denied in actual READ ONLY SQL');
  for(const actor of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
   await assert.rejects(role(actor,'select '+source+'('+managerArgs+') as data',params),e=>e.code==='42501');
  await assert.rejects(role('service_role','select custodial_recovery.read_original_inventory_manifest_for_manager('+managerArgs+')',params),e=>e.code==='42501');
  await assert.rejects(role('service_role','select custodial_recovery.assert_inventory_manager_read('+managerKinds.slice(0,8).map((k,i)=>'$'+(i+1)+'::'+k).join(',')+')',managerArguments),e=>e.code==='42501');
  assert.equal((await read())[0].data.manifest_utf8,data.manifest_utf8);assert.equal(await count(),2);
  checks.push('new public RPC only exact service caller; private helpers and other runtime callers denied, originals unchanged');
  return {checks,actual_SQL:true,actual_READ_ONLY:true,actual_HTTP:false,source_rows:2,prerequisite_writer_calls:writes,
   raw_manifest_sha256:sha(manifest),raw_manifest_bytes:manifest.length,source_protocol:data.schema,
   semantic_review:false,real_manager:false,actual_native_manifest_producer:false,ACK:false,finalizer:false,key_removal:false,production:false};
 }finally{manifest.fill(0);}
}
async function qualifyNewHttpComposition(selected=[]){
 const allowed=['healthy','foreign_origin','lost_reply','changed_auth_after_possible_commit','wrong_effect_receipt'];
 if(selected.some(x=>!allowed.includes(x)))throw new Error('unknown new HTTP mode');
 const outcomes=[];
 for(const mode of allowed){
  if(selected.length&&!selected.includes(mode))continue;
  const f=inventoryRequestFixture(),secret='SYNTHETIC_NATIVE_INVENTORY_TOKEN_ONLY_'.repeat(2),bytes=Buffer.from('SYNTHETIC_MANIFEST_FRAGMENT_NOT_SEMANTIC_INVENTORY');
  const parent={p_native_request:f.intent.intent_id,p_native_request_body_sha256:sha(f.req.scanAuthorityRawBody),
   intent_document_sha256:'a'.repeat(64),intent_disk_sha256:'b'.repeat(64)};
  const body=pieceBody(f.target,parent,bytes,0,bytes,secret),request=signedRequest(body,secret),raw=request.scanAuthorityRawBody;
  let calls=0;
  const app=express(),clients=new Set();
  installSameOriginalRecoveryNativeChallengeComposition(app,{env:f.deps.env,store:f.deps.store,runReadOnlySql:f.deps.runReadOnlySql,
   db:{async rpc(name,p){
    calls++;assert.equal(name,'custodial_register_original_inventory_manifest_chunk_v1');
    assert.equal(p.p_original_request_utf8,raw.toString('utf8'));assert.equal(p.p_native_request_body_sha256,sha(raw));
    const registered=new Date().toISOString().replace('Z','000Z'),r={schema:'custodial.native-original-inventory-manifest-chunk-registration.v1',
     state:'CHUNK_RETAINED_NOT_ACK',inventory_native_request_id:body.inventory_native_request_id,manifest_sha256:body.manifest_sha256,
     manifest_chunk_index:body.manifest_chunk_index,chunk_sha256:body.chunk_sha256,native_request_id:p.p_native_request,
     request_body_sha256:p.p_native_request_body_sha256,registered_at:registered,limits:{...denied}};
    r.receipt_sha256=sha(['custodial.native-original-inventory-manifest-chunk-receipt.v1',r.inventory_native_request_id,r.manifest_sha256,
     r.manifest_chunk_index,r.chunk_sha256,r.native_request_id,r.request_body_sha256,r.registered_at].join('\n'));
    if(mode==='lost_reply')throw new Error('SYNTHETIC_UNKNOWN_WRITER_REPLY_NO_REAL_SQL');
    if(mode==='changed_auth_after_possible_commit')f.deps.env.DEVICE_CREDENTIAL_SECRET='WITHDRAWN_SYNTHETIC_SOURCE';
    if(mode==='wrong_effect_receipt')r.limits.finalizer_allowed=true;
    return {data:JSON.stringify(r),error:null};
   }}});
  app.use(express.json());const server=http.createServer(app);
  server.on('connection',s=>{clients.add(s);s.on('close',()=>clients.delete(s));});
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const headers={...request.headers,'content-type':'application/json','content-length':String(raw.length)};
   if(mode==='foreign_origin')headers.origin='https://foreign.invalid';
   const observed=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:W.path,method:'POST',headers,agent:false},res=>{
     const parts=[];let size=0;res.on('data',part=>{size+=part.length;if(size>16384)req.destroy(new Error('bounded response'));else parts.push(part);});
     res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString('utf8'))});}catch(e){reject(e);}finally{for(const p of parts)p.fill(0);}});
    });req.setTimeout(5000,()=>req.destroy(new Error('bounded fixture HTTP timeout')));req.once('error',reject);req.end(raw);
   });
   assert.equal(observed.status,mode==='healthy'?200:mode==='foreign_origin'?403:503);
   assert.equal(calls,mode==='foreign_origin'?0:1);
   if(mode==='healthy'){assert.deepEqual(observed.body.data.limits,denied);assert.equal(observed.body.data.request_body_sha256,sha(raw));}
   else{assert.equal(observed.body.outcome,'UNKNOWN');assert.equal(observed.body.retry_safe,false);assert.deepEqual(observed.body.limits,denied);}
   outcomes.push({mode,status:observed.status,writer_calls:calls});
  }finally{
   if(server.listening)await new Promise(resolve=>server.close(resolve));for(const socket of clients)socket.destroy();
   assert.equal(server.listening,false);bytes.fill(0);raw.fill(0);
  }
 }
 console.log(JSON.stringify({NEW_HTTP_composition:outcomes,actual_HTTP:true,actual_SQL:false,genuine_manager:false,native_ACK:false,all_owned_servers_closed:true}));
}
async function qualifyNewStatusComposition(selected=[]){
 const allowed=['lost_reply_recovered','max_original_escaped','changed_current_principal','wrong_original_signature',
  'changed_original_bytes','wrong_read_id','unretained_unknown','bad_effect_receipt','closed_envelope'];
 if(selected.some(x=>!allowed.includes(x)))throw new Error('unknown new status mode');
 const outcomes=[];
 for(const mode of allowed){
  if(selected.length&&!selected.includes(mode))continue;
  const f=inventoryRequestFixture(),secret='SYNTHETIC_NATIVE_INVENTORY_TOKEN_ONLY_'.repeat(2),piece=Buffer.from('SYNTHETIC_STATUS_NOT_REAL_NATIVE_INVENTORY');
  const parent={p_native_request:f.intent.intent_id,p_native_request_body_sha256:sha(f.req.scanAuthorityRawBody),
   intent_document_sha256:'a'.repeat(64),intent_disk_sha256:'b'.repeat(64)};
  const body=pieceBody(f.target,parent,piece,0,piece,secret),original=signedRequest(body,secret);
  // No new WRITE timestamp for recovery. Older original remains identical;
  // only the outer READ signature is current.
  const originalTime=new Date(Date.now()-(mode==='lost_reply_recovered'?0:5*60000)).toISOString();
  let raw=original.scanAuthorityRawBody;
  if(mode==='max_original_escaped')raw=Buffer.concat([raw,Buffer.alloc(W.maxRequestBytes-raw.length,32)]);
  original.scanAuthorityRawBody=raw;original.headers['x-memphis-native-request-timestamp']=originalTime;
  const id=original.headers['x-memphis-native-request-id'],rawSha=sha(raw);
  const archivedSignature=hmac(secret,['custodial-native-request.v1',f.target.credential_id,f.target.canonical_device_id,
   'POST',W.path,rawSha,id,originalTime,'custodial'].join('\n'));
  original.headers['x-memphis-native-request-attestation']=archivedSignature;
  const registered=originalTime.replace('Z','000Z'),retained={schema:'custodial.native-original-inventory-manifest-chunk-registration.v1',
   state:'CHUNK_RETAINED_NOT_ACK',inventory_native_request_id:body.inventory_native_request_id,manifest_sha256:body.manifest_sha256,
   manifest_chunk_index:'0',chunk_sha256:body.chunk_sha256,native_request_id:id,request_body_sha256:rawSha,
   registered_at:registered,limits:{...denied}};
  retained.receipt_sha256=sha(['custodial.native-original-inventory-manifest-chunk-receipt.v1',retained.inventory_native_request_id,
   retained.manifest_sha256,'0',retained.chunk_sha256,id,rawSha,registered].join('\n'));
  let writerCalls=0,readerCalls=0,retainedText=mode==='lost_reply_recovered'?null:JSON.stringify(retained);
  const env={schema:SW.schema,purpose:SW.purpose,original_request_utf8:raw.toString('utf8'),
   original_request_timestamp:originalTime,original_request_attestation:archivedSignature};
  if(mode==='wrong_original_signature')env.original_request_attestation='0'.repeat(64);
  if(mode==='changed_original_bytes')env.original_request_utf8+='\n';
  const envelope=Buffer.from(JSON.stringify(env));
  if(mode==='closed_envelope'){
   const good=envelope.toString('utf8');assert.equal(decodeStatus(envelope).envelope.original_request_utf8,raw.toString('utf8'));
   for(const bad of [good+'{}',good.slice(0,-1)+',"purpose":'+JSON.stringify(SW.purpose)+'}',
    good.slice(0,-1)+',"finalizer_allowed":"true"}',good.slice(0,-1)+',}',good.replace('"schema":','"schema":{} ,"extra":')])
    assert.throws(()=>decodeStatus(Buffer.from(bad)));
   outcomes.push({mode,malformed_refused:5});raw.fill(0);envelope.fill(0);piece.fill(0);continue;
  }
  if(mode==='max_original_escaped'){assert.equal(raw.length,65536);assert.ok(envelope.length>65536&&envelope.length<=SW.maxRequestBytes);}
  if(mode==='changed_current_principal')f.row.revoked_at=new Date().toISOString();
  const app=express(),clients=new Set();
  installSameOriginalRecoveryNativeChallengeComposition(app,{env:f.deps.env,store:f.deps.store,
   async runReadOnlySql(sql){
    if(sql.startsWith('select public.custodial_read_original_inventory_manifest_chunk_v1(')){
     readerCalls++;assert.ok(sql.endsWith(') as data'));
     for(const text of [id,originalTime,rawSha,raw.toString('utf8').replaceAll("'","''")])assert.ok(sql.includes("'"+text+"'::"));
     if(mode==='unretained_unknown')return [{data:null}];
     const copy=JSON.parse(retainedText);if(mode==='bad_effect_receipt')copy.limits.key_removal=true;
     return [{data:JSON.stringify(copy)}];
    }
    return f.deps.runReadOnlySql(sql);
   },db:{async rpc(name,p){
    writerCalls++;assert.equal(mode,'lost_reply_recovered');assert.equal(name,'custodial_register_original_inventory_manifest_chunk_v1');
    assert.equal(p.p_original_request_utf8,raw.toString('utf8'));assert.equal(p.p_native_request,id);
    retainedText=JSON.stringify(retained);throw new Error('SYNTHETIC_LOST_REPLY_AFTER_RECORDING_PORT_COMMIT');
   }}});
  app.use(express.json());const server=http.createServer(app);
  server.on('connection',s=>{clients.add(s);s.on('close',()=>clients.delete(s));});
  async function send(path,bytes,headers){return new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',agent:false,
    headers:{...headers,'content-type':'application/json','content-length':String(bytes.length)}},res=>{
     const parts=[];let size=0;res.on('data',p=>{size+=p.length;if(size>16384)req.destroy(new Error('bounded status response'));else parts.push(p);});
     res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString('utf8'))});}
      catch(e){reject(e);}finally{for(const p of parts)p.fill(0);}});
    });req.setTimeout(5000,()=>req.destroy(new Error('bounded status HTTP timeout')));req.once('error',reject);req.end(bytes);
  });}
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   if(mode==='lost_reply_recovered'){
    const lost=await send(W.path,raw,original.headers);assert.equal(lost.status,503);assert.equal(lost.body.outcome,'UNKNOWN');
    assert.equal(writerCalls,1);assert.equal(readerCalls,0);
   }
   const readId=mode==='wrong_read_id'?randomUUID():id,now=new Date().toISOString();
   const h={...original.headers,'x-memphis-native-request-id':readId,'x-memphis-native-request-timestamp':now,
    'x-memphis-native-request-attestation':hmac(secret,['custodial-native-request.v1',f.target.credential_id,
     f.target.canonical_device_id,'POST',SW.path,sha(envelope),readId,now,'custodial'].join('\n'))};
   const response=await send(SW.path,envelope,h),deniedMode=['changed_current_principal','wrong_original_signature','changed_original_bytes','wrong_read_id'].includes(mode);
   assert.equal(response.status,deniedMode?403:['unretained_unknown','bad_effect_receipt'].includes(mode)?503:200);
   assert.equal(writerCalls,mode==='lost_reply_recovered'?1:0);assert.equal(readerCalls,deniedMode?0:1);
   if(response.status===200){assert.deepEqual(response.body.data,retained);assert.equal(env.original_request_attestation,archivedSignature);
    assert.equal(env.original_request_timestamp,originalTime);assert.equal(sha(raw),rawSha);}
   else{assert.equal(response.body.outcome,'UNKNOWN');assert.equal(response.body.retry_safe,false);assert.deepEqual(response.body.limits,denied);}
   outcomes.push({mode,status:response.status,writerCalls,readerCalls,originalBytes:raw.length,envelopeBytes:envelope.length});
  }finally{
   if(server.listening)await new Promise(resolve=>server.close(resolve));for(const socket of clients)socket.destroy();
   assert.equal(server.listening,false);raw.fill(0);envelope.fill(0);piece.fill(0);
  }
 }
 console.log(JSON.stringify({NEW_SIGNED_STATUS_composition:outcomes,actual_HTTP:true,actual_SQL:false,
  genuine_manager:false,native_ACK:false,all_owned_servers_closed:true}));
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--status-new'){
 await qualifyNewStatusComposition(process.argv.slice(3));
}else if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--http-new'){
 await qualifyNewHttpComposition(process.argv.slice(3));
}else if(process.argv[1]===fileURLToPath(import.meta.url)){
 const f=inventoryRequestFixture(),secret='SYNTHETIC_NATIVE_INVENTORY_TOKEN_ONLY_'.repeat(2);
 const parent={p_native_request:f.intent.intent_id,p_native_request_body_sha256:sha(f.req.scanAuthorityRawBody),
  intent_document_sha256:'a'.repeat(64),intent_disk_sha256:'b'.repeat(64)},manifest=Buffer.alloc(2*W.chunkBytes,7);
 const good=pieceBody(f.target,parent,manifest,0,manifest.subarray(0,W.chunkBytes),secret);
 const raw=Buffer.from(JSON.stringify(good));assert.ok(raw.length<=W.maxRequestBytes);
 assert.equal(decode(raw).body.manifest_chunk_count,'2');console.log('PASS_NEW_MANIFEST_DECODER exact bounded piece and purpose transcript');
 for(const change of [{manifest_chunk_count:'1'},{manifest_chunk_index:'2'},{manifest_byte_count:'16777217'},
  {chunk_sha256:'0'.repeat(64)},{purpose:'REQUEST_EXACT_ORIGINAL_INVENTORY_ACK'},{chunk_base64:good.chunk_base64+'\n'}]){
  const bad=pieceBody(f.target,parent,manifest,0,manifest.subarray(0,W.chunkBytes),secret,change);
  assert.throws(()=>decode(Buffer.from(JSON.stringify(bad))));
 }
 assert.throws(()=>decode(Buffer.from(JSON.stringify({...good,finalizer_allowed:true}))));
 console.log('PASS_NEW_MANIFEST_DECODER malformed/foreign purpose/extra rights/size/index/hash/base64 refuse');
 manifest.fill(0);raw.fill(0);
 console.log('SYNTHETIC_BODY_DATA_ONLY_NOT_SQL_AUTH_NATIVE_ISSUER_ACK');
}
