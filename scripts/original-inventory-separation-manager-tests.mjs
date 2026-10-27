import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHmac,createHash} from 'node:crypto';
import {installOriginalInventorySeparationManagerComposition as install} from '../src/original-inventory-separation-manager-composition.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {recoveryTargetFields} from '../src/same-original-recovery-wire.js';
import * as wire from '../src/original-inventory-separation-wire.js';
import {pathToFileURL} from 'node:url';
import {createOriginalInventoryManifestFixture,originalInventoryManifestPins} from './native-original-inventory-manifest-tests.mjs';

// NEW shipping composition cases only. Actual auth/parser/store callbacks;
// signed actor rows, inventory and SQL responses are explicitly SYNTHETIC.
// This does not qualify SQL, complete inventory, native ACK or a real manager.
const id=n=>'96000000-0000-4000-8000-'+String(n).padStart(12,'0'),sha=c=>c.repeat(64);
function fixture(joinOptions=null){
 const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',
  OPS_MANAGER_SESSION_SECRET:'synthetic-inventory-manager-session-secret-01',
  DEVICE_CREDENTIAL_SECRET:'synthetic-inventory-security-cookie-secret-02'};
 if(joinOptions?.shortSigned)env.OPS_MANAGER_ACCESS_TTL_MS='60000';
 const now=Date.now(),secret='synthetic-cookie-secret-32-characters-long',csrf='synthetic-csrf-secret-32-characters-long';
 const hash=(purpose,value)=>createHmac('sha256',env.DEVICE_CREDENTIAL_SECRET).update(purpose+':'+value).digest('hex');
 const manager={manager_id:id(40),display_name:'Synthetic Owner',system_key:'eric_custodial_manager',
  is_system_principal:false,roles:['CUSTODIAL_MANAGER','SECURITY_ADMIN'],active:true,revoked_at:null};
 const credential={credential_id:id(41),device_id:'inventory-manager-fixture',manager_id:manager.manager_id,manager,
  max_access_level:'full_access',created_at:new Date(now-1000).toISOString(),
  expires_at:new Date(now+86400000).toISOString(),revoked_at:null};
 const config={password_hash:sha('a'),password_version:1,sessions_revoked_at:null};
 const session={session_id:id(42),manager_id:manager.manager_id,credential_id:credential.credential_id,
  password_version:1,token_hash:hash('device-security-session',secret),csrf_hash:hash('device-security-csrf',csrf),
  created_at:new Date(now-1000).toISOString(),expires_at:new Date(now+900000).toISOString(),revoked_at:null};
 const signed=createOpsManagerSession({credentialId:credential.credential_id,deviceId:credential.device_id,
  manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
 const headers={authorization:'Bearer '+signed.token,cookie:'memphis_device_security_session='+session.session_id+'.'+secret,
  'x-device-security-csrf':csrf};
 const issuer={manager_id:manager.manager_id,manager_credential_id:credential.credential_id,manager_device_id:credential.device_id};
 const target=Object.fromEntries(recoveryTargetFields.map(key=>[key,
  ['operation_id','separation_id','canonical_device_pk','employee_id','credential_id','original_generation_id'].includes(key)?id(1):
  ['assignment_epoch','separation_authority_revision'].includes(key)?'7':key==='engine_revision'?'0':
  key==='canonical_device_id'?'KIOSK_08':sha('a')]));
 const review={schema:'custodial.original-inventory-separation-review.v1',state:'COMPLETE_ORIGINAL_INVENTORY_REVIEW_ONLY',
  purpose:wire.inventorySeparationPurpose,native_request_id:id(2),original_target:target,
  original_employee_label:'Fixture employee',original_device_label:'Fixture Kiosk 08',
  registration_receipt_sha256:sha('b'),inventory_manifest_sha256:sha('c'),review_sha256:sha('d'),issuer,
  native_namespaces:wire.inventorySeparationNativeNamespaces.map(namespace=>({namespace,record_count:1,accepted_exact_original_count:0,unresolved_retained_count:1})),
  browser_summary:{declared_domains:8,record_count:4,accepted_exact_original_count:1,unresolved_retained_count:3,frame_sha256:sha('e'),part_set_sha256:sha('f')},
  retained_key_family_count:2,reviewed_at:'2026-10-16T11:50:00.000000Z',expires_at:'2026-10-16T11:55:00.000000Z',
  limits:{...wire.inventorySeparationDeniedEffects}};
 const original={schema:'custodial.original-inventory-separation-request.v1',request_id:id(3),native_request_id:id(2),
  expected_review_sha256:review.review_sha256,expected_inventory_manifest_sha256:review.inventory_manifest_sha256,
  expected_registration_receipt_sha256:review.registration_receipt_sha256,expected_separation_authority_revision:'7',
  expected_manager_id:issuer.manager_id,expected_manager_credential_id:issuer.manager_credential_id,
  expected_manager_device_id:issuer.manager_device_id,decision:wire.inventorySeparationPurpose,
  manager_confirmation:wire.inventorySeparationConfirmation};
 const receipt={schema:'custodial.original-inventory-separation-receipt.v1',state:'INVENTORY_ACK_RECORDED_LOGICAL_SEPARATION_ONLY',
  approval_id:id(4),original_request:original,original_request_sha256:sha('a'),original_target:target,issuer,
  inventory_manifest_sha256:review.inventory_manifest_sha256,registration_receipt_sha256:review.registration_receipt_sha256,
  approved_at:review.reviewed_at,expires_at:review.expires_at,receipt_sha256:sha('b'),retry_safe:false,
  purpose_admission_id:'exact-original-retained-inventory-separation.v1',
  limits:{...wire.inventorySeparationDeniedEffects,inventory_acknowledged:true,finalizer_allowed:true}};
 let source=null;
 if(joinOptions){
  const manifest=createOriginalInventoryManifestFixture();manifest.native_request_id=original.native_request_id;
  for(const key of recoveryTargetFields)target[key]=manifest.original_target[key];
  const manifestUtf8='\n '+JSON.stringify(manifest)+'\t';
  const expected=originalInventoryManifestPins(manifest,Buffer.from(manifestUtf8));
  source={schema:'custodial.original-inventory-manifest-manager-source.v1',
   state:'CURRENT_MANAGER_ORIGINAL_MANIFEST_DATA_ONLY_NOT_REVIEW_OR_ACK',manifest_utf8:manifestUtf8,
   expected_original:expected,original_registration_receipt_sha256:review.registration_receipt_sha256,
   observed_at:new Date(now).toISOString().replace('Z','000Z'),
   current_until:new Date(now+60000).toISOString().replace('Z','000Z'),transaction_authority:false,
   limits:{...wire.inventorySeparationDeniedEffects}};
  review.native_namespaces=joinOptions.namespaceOrder==='wire'?wire.inventorySeparationNativeNamespaces.map(
   namespace=>structuredClone(manifest.native_namespaces.find(row=>row.namespace===namespace))):structuredClone(manifest.native_namespaces);
  review.browser_summary={declared_domains:manifest.browser_domains.length,record_count:manifest.browser_records.length,
   accepted_exact_original_count:manifest.browser_accepted_exact_original_count,
   unresolved_retained_count:manifest.browser_unresolved_retained_count,frame_sha256:manifest.browser_value_frame.frame_sha256,
   part_set_sha256:manifest.browser_part_set_sha256};
  review.retained_key_family_count=manifest.retained_key_families.length;
  review.inventory_manifest_sha256=expected.manifest_sha256;
  review.reviewed_at=new Date(now).toISOString().replace('Z','000Z');
  review.expires_at=new Date(now+60000).toISOString().replace('Z','000Z');
  original.expected_inventory_manifest_sha256=review.inventory_manifest_sha256;
  original.expected_separation_authority_revision=target.separation_authority_revision;
  receipt.inventory_manifest_sha256=review.inventory_manifest_sha256;
  receipt.approved_at=review.reviewed_at;receipt.expires_at=review.expires_at;
 }
 const calls=[],registrations=[];let beforeRpc=()=>{},afterRpc=()=>{},requestRow,badRawHash=false,sourceMissing=false;
 const db={async rpc(name,args){calls.push({name,args});await beforeRpc(name,args,requestRow);
  if(!name.endsWith('review_v1')&&(!joinOptions||!name.endsWith('manifest_v1')))receipt.original_request_sha256=badRawHash?sha('0'):
   createHash('sha256').update(args.p_original_utf8,'utf8').digest('hex');
  const value=joinOptions&&name.endsWith('manifest_v1')?(sourceMissing?null:source):name.endsWith('review_v1')?review:receipt;
  const data=joinOptions?(name.endsWith('manifest_v1')||joinOptions.rpcFormat!=='string'?value:JSON.stringify(value)):
   JSON.stringify(value);
  await afterRpc(name,args,requestRow);
  const response=joinOptions?{data,error:null,count:null,status:200,statusText:'OK'}:{data,error:null};
  return joinOptions?.transformRpcResult?joinOptions.transformRpcResult(name,response):response;}};
 const trustedDeviceStore={async find(){return structuredClone(credential);}};
 const securityStore={async getManager(){return structuredClone(manager);},async getDeviceSecurityConfig(){return structuredClone(config);},
  async findDeviceSecuritySession(){return structuredClone(session);}};
 const app=Object.fromEntries(['use','get','post'].map(method=>[method,(...args)=>registrations.push({method,args})]));
 const dependencies={env,trustedDeviceStore,securityStore,db},installed=install(app,dependencies);
 async function invoke(kind,options={}){
  const req=new EventEmitter(),res=new EventEmitter(),raw=options.raw??Buffer.from('\n '+JSON.stringify(original,null,2)+'\t');
  const url=options.url??(kind==='preview'?wire.inventorySeparationApi+'/reviews/'+id(2):
   kind==='confirm'?installed.paths.confirm:installed.paths.originalStatus);
  Object.assign(req,{method:options.method??(kind==='preview'?'GET':'POST'),originalUrl:url,url,path:url,
   params:{nativeRequestId:id(2)},headers:{...headers,...(kind==='preview'?{}:{'content-type':'application/json','content-length':String(raw.length)}),...options.headers}});
  Object.assign(res,{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},
   json(v){this.body=v;this.writableEnded=true;return this;},end(){this.writableEnded=true;}});
  requestRow={req,res};let next=false;
  registrations.find(x=>x.method==='use').args[0](req,res,()=>{next=true;});
  if(next){
   const callback=registrations.find(x=>x.method===(kind==='preview'?'get':'post')&&x.args[0]===(kind==='preview'?installed.paths.preview:url))?.args[1];
   assert.ok(callback,'exact registered route');
   if(kind==='preview')await callback(req,res);
   else{callback(req,res);if(!res.writableEnded){req.emit('data',raw);const onEnd=req.listeners('end')[0];if(onEnd)await onEnd.call(req);}}
  }
  assert.equal(req.scanAuthorityRawBody,undefined);assert.equal(req.body,undefined);
  for(const event of ['data','end','aborted','close','error'])assert.equal(req.listenerCount(event),0);
  assert.equal(res.listenerCount('close'),0);
  return {req,res,raw};
 }
 return {original,review,receipt,session,manager,credential,config,calls,dependencies,invoke,source,
  missingSource(){sourceMissing=true;},
  before(f){beforeRpc=f;},after(f){afterRpc=f;},wrongRawHash(){badRawHash=true;}};
}
const cases=[];
function test(name,run){cases.push([name,run]);}
test('new inventory review uses actual manager auth and one fixed reader',async()=>{
 const f=fixture(),{res}=await f.invoke('preview');assert.equal(res.statusCode,200);
 assert.deepEqual(res.body.data,f.review);assert.deepEqual(res.body.data.limits,wire.inventorySeparationDeniedEffects);
 assert.deepEqual(f.calls.map(c=>c.name),['custodial_original_inventory_separation_review_v1']);
});
test('explicit confirm keeps exact original UTF8 and fixed authenticated SQL parameters',async()=>{
 const f=fixture(),{res,raw}=await f.invoke('confirm');assert.equal(res.statusCode,200);
 assert.deepEqual(f.calls.map(c=>c.name),['custodial_original_inventory_separation_review_v1','custodial_original_inventory_separation_issue_v1']);
 assert.equal(f.calls[1].args.p_original_utf8,raw.toString('utf8'));
 assert.equal(f.calls[1].args.p_security_session,f.session.session_id);
 assert.match(f.calls[1].args.p_signed_sha,/^[a-f0-9]{64}$/);
 assert.equal(res.body.data.limits.key_removal,false);assert.equal(res.body.data.limits.work_accepted,false);
});
test('lost issue reply stays UNKNOWN; original status does not reissue or rereview',async()=>{
 const f=fixture();f.after(name=>{if(name.endsWith('issue_v1'))throw new Error('lost after possible commit');});
 const first=await f.invoke('confirm');assert.equal(first.res.statusCode,503);assert.equal(first.res.body.retry_safe,false);
 f.after(()=>{});const outcome=await f.invoke('originalStatus');assert.equal(outcome.res.statusCode,200);
 assert.deepEqual(f.calls.map(c=>c.name),['custodial_original_inventory_separation_review_v1','custodial_original_inventory_separation_issue_v1','custodial_original_inventory_separation_status_v1']);
 assert.equal(f.calls[1].args.p_original_utf8,f.calls[2].args.p_original_utf8);
});
test('same actor but changed password-session binding during review refuses before issue',async()=>{
 const f=fixture();f.after(name=>{if(name.endsWith('review_v1'))f.session.expires_at=new Date(Date.parse(f.session.expires_at)+1).toISOString();});
 const {res}=await f.invoke('confirm');assert.equal(res.statusCode,403);
 assert.equal(f.calls.filter(c=>c.name.endsWith('issue_v1')).length,0);
});
test('session change after possible commit cannot publish a current grant or retry',async()=>{
 const f=fixture();f.after(name=>{if(name.endsWith('issue_v1'))f.session.expires_at=new Date(Date.parse(f.session.expires_at)+1).toISOString();});
 const {res}=await f.invoke('confirm');assert.equal(res.statusCode,503);assert.equal(res.body.outcome,'UNKNOWN');
 assert.equal(f.calls.filter(c=>c.name.endsWith('issue_v1')).length,1);assert.deepEqual(res.body.limits,wire.inventorySeparationDeniedEffects);
});
test('withdrawn manager and missing confirm CSRF never reach SQL',async()=>{
 const f=fixture();f.manager.active=false;assert.equal((await f.invoke('preview')).res.statusCode,403);assert.equal(f.calls.length,0);
 const g=fixture();assert.equal((await g.invoke('confirm',{headers:{'x-device-security-csrf':''}})).res.statusCode,403);assert.equal(g.calls.length,0);
});
test('changed review pins and foreign returned original refuse without substitution',async()=>{
 const f=fixture();f.review.inventory_manifest_sha256=sha('f');
 assert.equal((await f.invoke('confirm')).res.statusCode,409);assert.equal(f.calls.length,1);
 const g=fixture();g.receipt.original_request={...g.original,request_id:id(99)};
 const {res}=await g.invoke('confirm');assert.equal(res.statusCode,503);assert.equal(res.body.outcome,'UNKNOWN');
});
test('exact route and raw parser refuse suffix, duplicate keys and declared-length drift',async()=>{
 for(const options of [{url:wire.inventorySeparationApi+'/approvals?override=true'},
  {raw:Buffer.from('{"schema":"a","schema":"b"}')},{headers:{'content-length':'1'}}]){
  const f=fixture(),{res}=await f.invoke('confirm',options);assert.equal(res.statusCode,400);assert.equal(f.calls.length,0);
 }
});
test('request bytes mutated while reading inventory cannot reach writer',async()=>{
 const f=fixture();f.after((name,args,row)=>{if(name.endsWith('review_v1'))row.req.scanAuthorityRawBody[0]=33;});
 assert.equal((await f.invoke('confirm')).res.statusCode,403);assert.equal(f.calls.length,1);
});
test('missing or malformed manifest never promotes registration-only DATA',async()=>{
 const f=fixture();f.review.state='REGISTERED_REQUEST_ONLY_NOT_ACK';
 assert.equal((await f.invoke('confirm')).res.statusCode,503);assert.equal(f.calls.length,1);
});
test('closed normal composition rejects caller authority and alternate RPC dependencies',async()=>{
 const f=fixture(),app={use(){},get(){},post(){}};
 assert.throws(()=>install(app,{...f.dependencies,issuer:f.review.issuer}),/closed_dependencies/);
 assert.throws(()=>install(app,{...f.dependencies,db:{}}),/db.rpc/);
});
test('RAW_HASH exact retained noncanonical UTF8 survives issue and status',async()=>{
 const f=fixture(),first=await f.invoke('confirm');assert.equal(first.res.statusCode,200);
 assert.equal(first.res.body.data.original_request_sha256,createHash('sha256').update(first.raw).digest('hex'));
 const second=await f.invoke('originalStatus');assert.equal(second.res.statusCode,200);
 assert.equal(first.res.body.data.original_request_sha256,second.res.body.data.original_request_sha256);
 assert.notEqual(first.res.body.data.original_request_sha256,createHash('sha256').update(JSON.stringify(f.original)).digest('hex'));
});
test('RAW_HASH same object with wrong raw original hash cannot promote either outcome',async()=>{
 const f=fixture();f.wrongRawHash();
 assert.equal((await f.invoke('confirm')).res.statusCode,503);
 assert.equal((await f.invoke('originalStatus')).res.statusCode,503);
 assert.equal(f.calls.filter(c=>c.name.endsWith('issue_v1')).length,1);
});
test('MANIFEST_JOIN_sdk_object_preview_confirm',async()=>{
 const f=fixture({rpcFormat:'object'}),preview=await f.invoke('preview');
 assert.equal(preview.res.statusCode,200);assert.deepEqual(preview.res.body.data,f.review);
 const confirmed=await f.invoke('confirm');assert.equal(confirmed.res.statusCode,200);
 assert.deepEqual(f.calls.map(x=>x.name),['custodial_original_inventory_separation_manifest_v1',
  'custodial_original_inventory_separation_review_v1','custodial_original_inventory_separation_manifest_v1',
  'custodial_original_inventory_separation_review_v1','custodial_original_inventory_separation_issue_v1']);
 assert.equal(f.calls[4].args.p_original_utf8,confirmed.raw.toString('utf8'));
});
test('MANIFEST_JOIN_same_partitions_different_order',async()=>{
 const f=fixture({rpcFormat:'string',namespaceOrder:'wire'}),{res}=await f.invoke('preview');
 assert.equal(res.statusCode,200);assert.deepEqual(res.body.data.native_namespaces,f.review.native_namespaces);
});
test('MANIFEST_JOIN_source_expires_during_review',async()=>{
 const f=fixture({rpcFormat:'string'});
 f.before(name=>{if(name.endsWith('manifest_v1')){
  f.source.observed_at=new Date().toISOString().replace('Z','000Z');
  f.source.current_until=new Date(Date.now()+300).toISOString().replace('Z','000Z');
 }});
 f.after(async name=>{if(name.endsWith('review_v1'))await new Promise(resolve=>setTimeout(resolve,500));});
 const {res}=await f.invoke('confirm');console.log('MANIFEST_JOIN_EXPIRY_CALLS '+JSON.stringify(f.calls.map(x=>x.name)));
 assert.equal(res.statusCode,503);
 assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,0);
});
test('MANIFEST_JOIN_source_window_never_exceeds_fixed_limit',async()=>{
 const f=fixture({rpcFormat:'string'});
 f.before(name=>{if(name.endsWith('manifest_v1')){
  f.source.observed_at=new Date().toISOString().replace('Z','000Z');
  f.source.current_until=new Date(Date.now()+301000).toISOString().replace('Z','000Z');
 }});
 const {res}=await f.invoke('preview');console.log('MANIFEST_JOIN_WINDOW_CALLS '+JSON.stringify(f.calls.map(x=>x.name)));
 assert.equal(res.statusCode,503);assert.equal(f.calls.length,1);
});
test('MANIFEST_JOIN_missing_partial_foreign_source_never_reaches_review',async()=>{
 for(const mutate of [
  f=>f.missingSource(),f=>delete f.source.expected_original,
  f=>f.source.state='REGISTERED_REQUEST_ONLY_NOT_ACK',
  f=>f.source.expected_original.original_target.operation_id=id(99),
  f=>f.source.expected_original.inventory_native_request_id=id(99),
  f=>f.source.manifest_utf8+=' false',f=>f.source.limits.finalizer_allowed=true,
  f=>f.source.original_registration_receipt_sha256='A'.repeat(64),
  f=>f.source.manifest_utf8='{"schema":"duplicate","schema":"duplicate"}'
 ]){
  const f=fixture({rpcFormat:'object'});mutate(f);
  const {res}=await f.invoke('confirm');assert.equal(res.statusCode,503);
  assert.deepEqual(f.calls.map(x=>x.name),['custodial_original_inventory_separation_manifest_v1']);
  assert.equal(res.body.retry_safe,false);assert.deepEqual(res.body.limits,wire.inventorySeparationDeniedEffects);
 }
});
test('MANIFEST_JOIN_withdrawal_across_source_await_never_issues',async()=>{
 for(const withdraw of [
  f=>f.manager.active=false,f=>f.credential.revoked_at=new Date().toISOString(),
  f=>f.config.password_version++,f=>f.session.revoked_at=new Date().toISOString(),
  f=>f.session.token_hash=sha('0'),
  f=>f.session.expires_at=f.session.expires_at.replace('Z','000+00:00'),
  (f,row)=>row.req.headers.authorization+='withdrawn'
 ]){
  const f=fixture({rpcFormat:'object'});f.after((name,args,row)=>{if(name.endsWith('manifest_v1'))withdraw(f,row);});
  const {res}=await f.invoke('confirm');
  // Normal signed/password-session authentication returns 401 for revoked
  // credentials/session and 403 for a changed live binding. Both are denial.
  assert.ok([401,403].includes(res.statusCode));
  assert.equal(res.body.code,'original_inventory_separation_issuer_denied');
  assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,0);
 }
});
test('MANIFEST_JOIN_mismatched_review_pin_or_summary_never_issues',async()=>{
 for(const mismatch of [
  r=>{r.native_namespaces[0].record_count++;r.native_namespaces[0].unresolved_retained_count++;},
  r=>{r.browser_summary.record_count++;r.browser_summary.unresolved_retained_count++;},
  r=>r.browser_summary.frame_sha256=sha('0'),r=>r.browser_summary.part_set_sha256=sha('0'),
  r=>r.registration_receipt_sha256=sha('0'),r=>r.inventory_manifest_sha256=sha('0'),
  r=>r.retained_key_family_count++,r=>r.original_target.operation_id=id(99)
 ]){
  const f=fixture({rpcFormat:'object'});f.after(name=>{if(name.endsWith('manifest_v1'))mismatch(f.review);});
  const {res}=await f.invoke('confirm');assert.equal(res.statusCode,503);
  assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,0);
 }
});
test('MANIFEST_JOIN_lost_issue_reply_status_uses_only_original',async()=>{
 const f=fixture({rpcFormat:'object'});
 f.after(name=>{if(name.endsWith('issue_v1'))throw Error('synthetic lost reply');});
 const first=await f.invoke('confirm');assert.equal(first.res.statusCode,503);assert.equal(first.res.body.retry_safe,false);
 f.after(()=>{});f.missingSource();f.source.manifest_utf8='unavailable old Source';
 const before=f.calls.length,outcome=await f.invoke('originalStatus');assert.equal(outcome.res.statusCode,200);
 assert.deepEqual(f.calls.slice(before).map(x=>x.name),['custodial_original_inventory_separation_status_v1']);
 assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,1);
 assert.equal(f.calls[before].args.p_original_utf8,f.calls.find(x=>x.name.endsWith('issue_v1')).args.p_original_utf8);
 assert.equal(outcome.res.body.data.original_request_sha256,createHash('sha256').update(outcome.raw).digest('hex'));
});
test('MANIFEST_JOIN_finite_microsecond_and_utc_offset_expiry_pins',async()=>{
 for(const format of [
  iso=>iso,iso=>iso.replace('Z','000Z'),iso=>iso.replace('Z','000+00:00'),
  iso=>iso.replace('Z','+00:00')
 ]){
  const f=fixture({rpcFormat:'object'});
  f.session.expires_at=format(new Date(Date.now()+600000).toISOString());
  assert.equal((await f.invoke('preview')).res.statusCode,200);
 }
 for(const edge of ['security','signed']){
  const f=fixture({rpcFormat:'object',shortSigned:edge==='signed'});
  if(edge==='security')f.session.expires_at=new Date(Date.now()+30000).toISOString();
  f.before((name,args)=>{if(name.endsWith('manifest_v1')){
   const bound=edge==='security'?f.session.expires_at:args.p_signed_expires;
   // This exceeds the exact original millisecond expiry by ONE microsecond.
   f.source.current_until=bound.replace('Z','001Z');
  }});
  assert.equal((await f.invoke('preview')).res.statusCode,503);
  assert.equal(f.calls.length,1);
 }
 for(const bad of ['infinity','2026-02-30T10:00:00.000000Z','2026-10-16T10:00:00.000Z','0000-01-01T00:00:00.000000Z']){
  const f=fixture({rpcFormat:'object'});f.source.current_until=bad;
  assert.equal((await f.invoke('preview')).res.statusCode,503);assert.equal(f.calls.length,1);
 }
});
test('MANIFEST_JOIN_object_rpc_values_are_bounded_detached_data',async()=>{
 for(const alter of [
  data=>new Proxy(data,{}),
  data=>Object.defineProperty(data,'schema',{enumerable:true,get(){throw Error('must not call');}}),
  data=>({...data,unknown:true}),data=>({...data,unknown:'x'.repeat(24577)}),
  data=>({...data,toJSON(){throw Error('must not call');}})
 ]){
  const f=fixture({rpcFormat:'object',transformRpcResult(name,result){
   if(name.endsWith('review_v1'))return {...result,data:alter(structuredClone(result.data))};
   return result;
  }});
  assert.equal((await f.invoke('confirm')).res.statusCode,503);
  assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,0);
 }
});
test('OWNED_MANIFEST_READ_expiry_across_final_auth_never_dispatches',async()=>{
 const f=fixture({rpcFormat:'object'});
 const getManager=f.dependencies.securityStore.getManager;
 let delay=false;
 f.dependencies.securityStore.getManager=async function(...args){
  if(delay){delay=false;await new Promise(resolve=>setTimeout(resolve,500));}
  return Reflect.apply(getManager,this,args);
 };
 f.before(name=>{if(name.endsWith('manifest_v1')){
  f.source.observed_at=new Date().toISOString().replace('Z','000Z');
  f.source.current_until=new Date(Date.now()+300).toISOString().replace('Z','000Z');
 }});
 f.after(name=>{if(name.endsWith('review_v1'))delay=true;});
 const {res}=await f.invoke('confirm');
 assert.equal(f.calls.filter(x=>x.name.endsWith('issue_v1')).length,0,
  'the exact original manifest read expired during final manager authentication');
 assert.equal(res.statusCode,503);assert.equal(res.body.retry_safe,false);
 assert.deepEqual(res.body.limits,wire.inventorySeparationDeniedEffects);
});
export {fixture as createInventoryManagerCompositionFixture};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const selected=process.argv.slice(2);
 if(selected.some(name=>!cases.some(([n])=>n===name||name==='--raw-hash-new'&&n.startsWith('RAW_HASH')
  ||name==='--manifest-join-new'&&n.startsWith('MANIFEST_JOIN'))))throw new Error('unknown new case');
 let ran=0;for(const [name,run]of cases){if(selected.length&&!selected.includes(name)
  &&!(selected.includes('--raw-hash-new')&&name.startsWith('RAW_HASH'))
  &&!(selected.includes('--manifest-join-new')&&name.startsWith('MANIFEST_JOIN')))continue;
  await run();ran++;console.log('PASS '+name);}
 console.log(JSON.stringify({executed_composition_cases:ran,sql:'NOT_RUN',native_ack:'NOT_RUN',genuine_manager:'NOT_RUN',resources:'CLOSED_RECORDING_FACILITY'}));
}
