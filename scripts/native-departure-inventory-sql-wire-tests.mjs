import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import express from 'express';
import {canonicalNativeAlert} from '../src/native-alert-reservation.js';
import {validateNativeProviderInventoryPayload} from '../src/native-provider-inventory-payload.js';
import {validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
const [resultPath,predecessorRoot]=process.argv.slice(2);
assert.ok(resultPath,'Pass completed isolated DEPARTURE_DATABASE_RESULTS.json');
const result=JSON.parse(readFileSync(resolve(resultPath),'utf8'));
assert.equal(result.status,'PASS');assert.equal(result.sql_executed,true);assert.equal(result.production,false);assert.equal(result.cases.length,37);
const sha=x=>createHash('sha256').update(x).digest('hex');
const actor=p=>({generation_id:p.generation_id,principal_digest:p.principal_digest,credential_id:p.receipt_credential_id,
 employee_id:p.receipt_employee_id,device_id:p.receipt_device_id,assignment_epoch:p.receipt_assignment_epoch});
const rehash=p=>({...p,content_sha256:sha(canonicalNativeAlert(p,{excludeHash:true}))});
let checks=0;const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;};
const reject=(label,fn)=>{assert.throws(fn,undefined,label);checks++;};
let predecessor=null;
if(predecessorRoot){
 const name=resolve(predecessorRoot,'backend/src/native-provider-inventory-payload.js'),bytes=readFileSync(name);
 assert.equal(sha(bytes),'0994ae2f5ef507bfd90c574a097042a17602290d550e21c15be433992db7edba');
 const source=bytes.toString().replace(/from '\.\/([^']+)'/g,(_m,p)=>`from '${new URL('../src/'+p,import.meta.url).href}'`);
 predecessor=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).validateNativeProviderInventoryPayload;
}
const envelope=(p,outcome='prepared')=>{
 const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),principal_digest:p.principal_digest,
  device_id:p.receipt_device_id,credential_id:p.receipt_credential_id,employee_id:p.receipt_employee_id,assignment_epoch:Number(p.receipt_assignment_epoch),
  generation_ids:[p.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 const cursor={reservation_at:p.reservation_at,job_id:p.receipt_job_id};
 const data={...request,schema:'custodial.native-provider-inventory.v1',server_now:p.reservation_at,has_more:false,cursor,ceiling:cursor,
  rows:[{payload:p,provider_outcome:outcome}]};delete data.limit;
 return {request,response:{ok:true,data}};
};
for(const {payload:p} of result.cases){
 if(predecessor)reject('original parser rejects actual SQL v2 wire',()=>predecessor(p,actor(p)));
 check('actual SQL v2 payload accepted unchanged',validateNativeProviderInventoryPayload(p,actor(p)),p);
 check('accepted payload frozen',Object.isFrozen(validateNativeProviderInventoryPayload(p,actor(p))),true);
 for(const outcome of ['prepared','delivery_outcome_unknown','provider_accepted']){
  const {request,response}=envelope(p,outcome);check('actual wire inventory outcome '+outcome,validateNativeLocationInventoryResponse(response,request),response);
 }
 for(const k of Object.keys(p))reject('closed payload field '+k,()=>{const v={...p};delete v[k];validateNativeProviderInventoryPayload(v,actor(p));});
 for(const change of [{schema:'custodial.native-schedule-payload.v1'},{schema:'custodial.native-schedule-payload.v3'},
  {boundary_local:'09:45'},{boundary_local:'14:00:00'},{boundary_local:'24:00'},{notification_key:'schedule-ownership:'+p.service_date+':'+p.receipt_employee_id+':09:45'},
  {projection_id:randomUUID()},{source_revision:'0'},{source_revision:'9007199254740992'},{source_revision:String(Number(p.source_revision)+1)},
  {source_valid_from:p.source_valid_from.replace('000000Z','000001Z')},{source_valid_until:p.source_valid_from},
  {receipt_employee_id:randomUUID()},{receipt_credential_id:randomUUID()},{generation_id:randomUUID()},
  {receipt_device_id:'KIOSK_01'},{receipt_assignment_epoch:'2.0'},{service_date:'2026-02-30'},
  {route:'https://external.invalid/'},{source_window_sha256:'bad'},{server_source_sha256:'bad'},{extra:'unbound'}]){
  reject('rehashed invalid v2 '+Object.keys(change)[0],()=>validateNativeProviderInventoryPayload(rehash({...p,...change}),actor(p)));
 }
 reject('digest tamper',()=>validateNativeProviderInventoryPayload({...p,content_sha256:'0'.repeat(64)},actor(p)));
 const {request,response}=envelope(p);
 for(const mutate of [
  x=>x.data.server_now=p.valid_until,
  x=>x.data.rows[0].provider_outcome='known_nonacceptance',
  x=>x.data.rows.push(structuredClone(x.data.rows[0])),
  x=>x.data.cursor.job_id=randomUUID(),
  x=>x.data.ceiling=null,
  x=>x.data.generation_ids=[randomUUID()],
 ])reject('inventory expiry/outcome/cursor/generation preserved',()=>{const v=structuredClone(response);mutate(v);validateNativeLocationInventoryResponse(v,request);});
}
// Real loopback HTTP and current HMAC middleware. RPC/credential envelopes are
// synthetic; each payload is the unchanged completed SQL rehearsal output.
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-departure-inventory-route-only'};
const secret='syntheticDepartureInventorySecret-abcdefghijklmnopqrstuvwxyz1234567890';
let credential,device,dbValue,requestId,sqlCalls=0;
const app=express();app.use(createGeneralJsonMiddleware());
installNativeProviderRoutes(app,{env,db:{rpc:async name=>{assert.equal(name,'custodial_native_provider_inventory_clock');sqlCalls++;return {data:dbValue};}},
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async id=>id===credential.credential_id?credential:null,touchCredential:async()=>{},audit:async()=>{}},
 runReadOnlySql:async()=>[device],requireEnrolledCredential:true})});
app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:'synthetic_error'}));
const server=await new Promise(resolveServer=>{const s=app.listen(0,'127.0.0.1',()=>resolveServer(s));});
const route='/employee-notifications-api/native-provider/inventory',origin='http://127.0.0.1:'+server.address().port;
let httpCases=0;
try{
 for(const {payload:p} of result.cases){
  const pk=randomUUID();requestId=randomUUID();
  credential={credential_id:p.receipt_credential_id,device_id:pk,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00.000Z',
   confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
  device={requested_device_id:p.receipt_device_id,canonical_device_id:p.receipt_device_id,canonical_device_pk:pk,device_id:p.receipt_device_id,device_name:'Synthetic departure inventory',
   device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',assignment_epoch:Number(p.receipt_assignment_epoch),assigned_employee_id:p.receipt_employee_id,assigned_employee_name:'Synthetic'};
  // Match the existing inventory_clock_at transport envelope: sampled_at plus
  // 15 minutes, capped by credential expiry (2099 in this synthetic adapter).
  // The notification's source validity is a separate interval, kept unchanged.
  assert.ok(p.reservation_at.endsWith('.000000Z'));
  const clockUntil=new Date(Date.parse(p.reservation_at)+15*60*1000).toISOString().replace('.000Z','.000000Z');
  const {request,response}=envelope(p);dbValue={...response,clock:{native_request_id:requestId,server_now:p.reservation_at,valid_until:clockUntil}};
  const bytes=JSON.stringify(request),timestamp=new Date().toISOString();
  const proof=['custodial-native-request.v1',p.receipt_credential_id,p.receipt_device_id,'POST',route,sha(bytes),requestId,timestamp,'custodial'].join('\n');
  const headers={'content-type':'application/json',authorization:`Device ${p.receipt_credential_id}.${secret}`,'x-device-id':p.receipt_device_id,origin:'https://localhost','x-memphis-app-edition':'custodial',
   'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':timestamp,
   'x-memphis-native-request-attestation':createHmac('sha256',secret).update(proof).digest('hex')};
  const call=async h=>{const r=await fetch(origin+route,{method:'POST',headers:h,body:bytes,signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};};
  const received=await call(headers);check('actual SQL wire passes real HMAC HTTP',received.status,200);check('exact wire unchanged through HTTP',received.body,dbValue);httpCases++;
  if(httpCases===1){
   const before=sqlCalls,bad={...headers};delete bad['x-memphis-native-request-attestation'];const denied=await call(bad);
   check('missing HMAC denied before SQL',denied.status>=400&&sqlCalls===before,true);
   dbValue=structuredClone(dbValue);dbValue.data.rows[0].payload=rehash({...p,boundary_local:'09:45'});
   check('invalid v2 SQL reply remains503',(await call(headers)).status,503);
  }
 }
}finally{server.closeAllConnections();await new Promise((done,fail)=>server.close(e=>e?fail(e):done()));}
console.log(JSON.stringify({status:'PASS',checks,sql_cases:result.cases.length,http_cases:httpCases,original_rejection_reproduced:!!predecessor,
 actual_payloads_from_completed_sql:true,actual_loopback_HTTP_and_HMAC:true,synthetic_HTTP_RPC_and_credentials:true,live_database:false,
 dispatch_authorized:false,native_qualified:false,phone:false,owned_http_server_closed:true}));
