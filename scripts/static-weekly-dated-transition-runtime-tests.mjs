import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';

// Actual application runtime/auth/router, explicit synthetic authority store.
const env={NODE_ENV:'test',SUPABASE_URL:'https://dated-transition-test.invalid',
 SUPABASE_SERVICE_ROLE_KEY:'synthetic-dated-transition-fixture-key',
 OPS_MANAGER_SESSION_SECRET:'synthetic-dated-transition-session-secret-0123456789'};
const principal={manager_id:'96000000-0000-4000-8000-000000000009',display_name:'Synthetic Manager',roles:['OPS_MANAGER'],active:true};
const session=createOpsManagerSession({credentialId:'dated-fixture',deviceId:'dated-device',manager:principal,
 authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
let revoked=false,calls=[];
const trustedDeviceStore={async find(){return {credential_id:'dated-fixture',device_id:'dated-device',
 max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),
 manager_id:principal.manager_id,manager:{...principal,active:!revoked}};}};
const syntheticController={};
for(const method of ['preview','confirm','status','rollback'])syntheticController[method]=async request=>{
 calls.push({method,request});return {syntheticAuthority:true,phoneDeliveryState:'PENDING',affectedPhonesUpdated:false};
};
const options={env,supabase:{async rpc(){return {data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};}},
 trustedDeviceStore,database:{},controlPlane:{},datedTransitionController:syntheticController};
const servers=[];const checks=[];
const check=(label,fn)=>{fn();checks.push(label);};
async function start(controller){
 const runtime=createStaticWeeklyControlPlaneRuntime({...options,datedTransitionController:controller});
 const server=createServer(runtime.app);servers.push(server);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return `http://127.0.0.1:${server.address().port}/static-weekly/dated-transition`;
}
async function request(origin,path,body,authenticated=true){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',
  ...(authenticated?{Authorization:`Bearer ${session.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
try{
 const origin=await start(syntheticController);
 for(const [path,body,method] of [
  ['/preview',{expected_revision:17},'preview'],
  ['/confirm',{expected_revision:17,idempotency_key:'exact-key',preview_digest:'a'.repeat(64)},'confirm'],
  ['/operations/exact-key',undefined,'status'],
  ['/rollback',{expected_revision:18,idempotency_key:'rollback-key',publication_id:'fixture-publication',projection_id:'fixture-projection'},'rollback'],
 ]){
  const result=await request(origin,path,body);
  check('actual named-manager route '+method,()=>{
   assert.equal(result.status,200);assert.equal(result.cache,'no-store');
   assert.equal(calls.at(-1).method,method);assert.deepEqual(calls.at(-1).request.manager,{managerId:principal.manager_id});
   assert.equal(result.body.data.phoneDeliveryState,'PENDING');assert.equal(result.body.data.affectedPhonesUpdated,false);
  });
 }
 for(const extra of [{manager_id:'forged-manager'},{days:[]},{effective_start:'2026-09-28'},{phone_pdf_revision:'forged'},
  {availability:[]},{accepted_exception:'fake-coverer'}]){
  const before=calls.length;const response=await request(origin,'/confirm',{
   expected_revision:17,idempotency_key:'exact-key',preview_digest:'a'.repeat(64),...extra});
  check('client facts rejected '+Object.keys(extra)[0],()=>{assert.equal(response.status,400);assert.equal(calls.length,before);});
 }
 let before=calls.length;let denied=await request(origin,'/preview',{expected_revision:17},false);
 check('unauthenticated caller never reaches bounded authority',()=>{assert.equal(denied.status,401);assert.equal(calls.length,before);});
 revoked=true;denied=await request(origin,'/confirm',{expected_revision:17,idempotency_key:'exact-key',preview_digest:'a'.repeat(64)});
 check('revoked manager never reaches bounded authority',()=>{assert.equal(denied.status,403);assert.equal(calls.length,before);});revoked=false;
 const disabled=await start(null);const unavailable=await request(disabled,'/preview',{expected_revision:17});
 check('default production configuration fails closed with precise missing adapter',()=>{
  assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'dated_transition_store_unavailable_requires_bounded_database_adapter');assert.equal(calls.length,before);
 });
 console.log(JSON.stringify({status:'PASS',checks:checks.length,scope:'actual runtime named-manager authorization and exact bounded route wiring with synthetic authority; no SQL/phone proof',productionWritten:false,checksPassed:checks}));
}finally{await Promise.all(servers.map(s=>new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()))));}
